import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AdjustStock,
  AuthenticatedUser,
  DocType,
  InventoryPosition,
  InventoryTxn as InventoryTxnDto,
  ItemType,
  StockPosition,
  StockStatus,
  TxnType,
  UnitOfMeasure,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";
import {
  applyInbound,
  applyOutbound,
  InsufficientStockError,
  type PostingResult,
} from "./stock-costing";

/** One movement to post. Magnitudes positive; direction signs it. status defaults INV. */
export interface Movement {
  itemId: string;
  type: TxnType;
  direction: "IN" | "OUT";
  quantity: string;
  /** Required for inbound; outbound costs out at the current average for that status. */
  unitCost?: string;
  /** Which bucket the movement lands in. Defaults to INV (LOT-traceable). */
  status?: StockStatus;
}

export interface PostingDoc {
  docType?: DocType;
  docId?: string;
  note?: string;
}

export interface PostedLine extends PostingResult {
  itemId: string;
  type: TxnType;
  status: StockStatus;
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Post movements to the ledger within an existing transaction. Each one
   * re-averages (inbound) or costs out at the average (outbound) for its
   * (item, status) bucket, writes the InventoryTxn with a running-balance
   * snapshot, and updates ItemStock. The INV bucket is mirrored onto
   * InventoryItem so existing reads (valuation, lists) keep working.
   */
  async post(
    tx: Prisma.TransactionClient,
    tenantId: string,
    movements: Movement[],
    doc: PostingDoc,
  ): Promise<PostedLine[]> {
    const posted: PostedLine[] = [];
    for (const movement of movements) {
      const status: StockStatus = movement.status ?? "INV";
      const item = await tx.inventoryItem.findFirst({
        where: { id: movement.itemId, tenantId },
      });
      if (!item) {
        throw new BadRequestException(`Item ${movement.itemId} not found`);
      }
      const stock = await tx.itemStock.findUnique({
        where: { itemId_status: { itemId: movement.itemId, status } },
      });
      // Fall back to the item's mirrored opening balance for INV when no
      // ItemStock row exists yet (e.g. an item created with an opening qty).
      const position = stock
        ? { quantity: stock.quantity.toString(), avgCost: stock.avgCost.toString() }
        : status === "INV"
          ? {
              quantity: item.quantityOnHand.toString(),
              avgCost: item.unitCost.toString(),
            }
          : { quantity: "0", avgCost: "0" };

      let result: PostingResult;
      if (movement.direction === "IN") {
        if (movement.unitCost === undefined) {
          throw new BadRequestException(
            `Inbound movement for ${item.sku} requires a unit cost`,
          );
        }
        result = applyInbound(position, movement.quantity, movement.unitCost);
      } else {
        try {
          result = applyOutbound(position, movement.quantity);
        } catch (err) {
          if (err instanceof InsufficientStockError) {
            throw new BadRequestException(
              `Insufficient ${status} stock for ${item.sku}: have ${err.available}, need ${err.requested}`,
            );
          }
          throw err;
        }
      }

      await tx.inventoryTxn.create({
        data: {
          tenantId,
          itemId: movement.itemId,
          type: movement.type,
          status,
          quantity: result.quantity,
          unitCost: result.unitCost,
          value: result.value,
          balanceQty: result.balanceQty,
          balanceAvgCost: result.balanceAvgCost,
          docType: doc.docType ?? null,
          docId: doc.docId ?? null,
          note: doc.note ?? null,
        },
      });
      await tx.itemStock.upsert({
        where: { itemId_status: { itemId: movement.itemId, status } },
        create: {
          tenantId,
          itemId: movement.itemId,
          status,
          quantity: result.balanceQty,
          avgCost: result.balanceAvgCost,
        },
        update: { quantity: result.balanceQty, avgCost: result.balanceAvgCost },
      });
      if (status === "INV") {
        await tx.inventoryItem.update({
          where: { id: movement.itemId },
          data: {
            quantityOnHand: result.balanceQty,
            unitCost: result.balanceAvgCost,
          },
        });
      }

      posted.push({ itemId: movement.itemId, type: movement.type, status, ...result });
    }
    return posted;
  }

  /**
   * Move stock between statuses (e.g. INV -> WIP, or pack-off WIP -> INV). Cost
   * flows with the goods: out at the source average, in at that same cost, so
   * the two ledger lines are value-balanced.
   */
  async transfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
    fromStatus: StockStatus,
    toStatus: StockStatus,
    quantity: string,
    doc: PostingDoc,
    type: TxnType = "TRANSFER",
  ): Promise<void> {
    const [out] = await this.post(
      tx,
      tenantId,
      [{ itemId, type, direction: "OUT", quantity, status: fromStatus }],
      doc,
    );
    if (!out) return;
    await this.post(
      tx,
      tenantId,
      [{ itemId, type, direction: "IN", quantity, unitCost: out.unitCost, status: toStatus }],
      doc,
    );
  }

  /** Manual adjustment (opening balances, counts, corrections) — INV bucket. */
  async adjust(
    user: AuthenticatedUser,
    itemId: string,
    input: AdjustStock,
  ): Promise<InventoryPosition> {
    await this.prisma.$transaction(async (tx) => {
      const movement: Movement = {
        itemId,
        type: "ADJUSTMENT",
        direction: input.direction,
        quantity: input.quantity,
        ...(input.unitCost === undefined ? {} : { unitCost: input.unitCost }),
      };
      const [line] = await this.post(tx, user.tenantId, [movement], {
        docType: "ADJUSTMENT",
        note: input.note ?? undefined,
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "InventoryItem",
        entityId: itemId,
        action: "UPDATE",
        after: { adjustment: input, balance: line?.balanceQty },
      });
    });
    return this.getPosition(user.tenantId, itemId);
  }

  /**
   * Pack-off: move a quantity of an item from FG_WIP to FG_INV (usable). Only
   * QC-APPROVED production-lot quantity may be packed off — FG can't leave WIP
   * until its lot passes QC. Allocates against approved lots FIFO.
   */
  async packOff(
    user: AuthenticatedUser,
    itemId: string,
    quantity: string,
  ): Promise<InventoryPosition> {
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, tenantId: user.tenantId },
      });
      if (!item) throw new NotFoundException("Inventory item not found");

      const requested = new Decimal(quantity);
      const lots = await tx.receivedLot.findMany({
        where: {
          tenantId: user.tenantId,
          itemId,
          origin: "PRODUCTION",
          qcStatus: "APPROVED",
        },
        orderBy: { receivedAt: "asc" },
      });
      const available = lots.reduce(
        (sum, lot) => sum.plus(lot.quantity.minus(lot.packedQty)),
        new Decimal(0),
      );
      if (requested.greaterThan(available)) {
        throw new BadRequestException(
          `Cannot pack off ${requested} of ${item.sku}: only ${available} is QC-approved in WIP`,
        );
      }

      // Consume approved lots FIFO.
      let remaining = requested;
      for (const lot of lots) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const lotRemaining = lot.quantity.minus(lot.packedQty);
        if (lotRemaining.lessThanOrEqualTo(0)) continue;
        const take = Decimal.min(remaining, lotRemaining);
        await tx.receivedLot.update({
          where: { id: lot.id },
          data: { packedQty: lot.packedQty.plus(take) },
        });
        remaining = remaining.minus(take);
      }

      await this.transfer(tx, user.tenantId, itemId, "WIP", "INV", quantity, {
        docType: "PRODUCTION_RUN",
        note: `Pack-off ${item.sku}`,
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "InventoryItem",
        entityId: itemId,
        action: "UPDATE",
        after: { packOff: quantity },
      });
    });
    return this.getPosition(user.tenantId, itemId);
  }

  /** Current LOT-traceable (INV) position of an item. */
  async getPosition(tenantId: string, itemId: string): Promise<InventoryPosition> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException("Inventory item not found");
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      unitOfMeasure: item.unitOfMeasure as UnitOfMeasure,
      quantityOnHand: item.quantityOnHand.toString(),
      avgCost: item.unitCost.toString(),
      totalValue: extendedValue(
        item.quantityOnHand.toString(),
        item.unitCost.toString(),
      ),
    };
  }

  async getLedger(tenantId: string, itemId: string): Promise<InventoryTxnDto[]> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("Inventory item not found");

    const txns = await this.prisma.inventoryTxn.findMany({
      where: { tenantId, itemId },
      orderBy: { occurredAt: "asc" },
    });
    return txns.map((t) => ({
      id: t.id,
      itemId: t.itemId,
      type: t.type as TxnType,
      status: t.status as StockStatus,
      quantity: t.quantity.toString(),
      unitCost: t.unitCost.toString(),
      value: t.value.toString(),
      balanceQty: t.balanceQty.toString(),
      balanceAvgCost: t.balanceAvgCost.toString(),
      docType: (t.docType as DocType | null) ?? null,
      docId: t.docId,
      note: t.note,
      occurredAt: t.occurredAt.toISOString(),
    }));
  }

  /** All per-(item, status) positions — drives the WIP vs LOT-traceable report. */
  async getStockPositions(tenantId: string): Promise<StockPosition[]> {
    const rows = await this.prisma.itemStock.findMany({
      where: { tenantId },
      include: { item: true },
      orderBy: [{ status: "asc" }],
    });
    return rows
      .map((r) => ({
        itemId: r.itemId,
        sku: r.item.sku,
        name: r.item.name,
        itemType: r.item.itemType as ItemType,
        status: r.status as StockStatus,
        quantity: r.quantity.toString(),
        avgCost: r.avgCost.toString(),
        totalValue: extendedValue(r.quantity.toString(), r.avgCost.toString()),
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.status.localeCompare(b.status));
  }
}

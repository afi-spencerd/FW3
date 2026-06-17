import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AdjustStock,
  AuthenticatedUser,
  DocType,
  InventoryPosition,
  InventoryTxn as InventoryTxnDto,
  ItemType,
  StockPosition,
  StockState,
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

/** One movement to post. Magnitudes positive; direction signs it. state defaults INV. */
export interface Movement {
  itemId: string;
  type: TxnType;
  direction: "IN" | "OUT";
  quantity: string;
  /** Required for inbound; outbound costs out at the current average for that state. */
  unitCost?: string;
  /** Which bucket the movement lands in. Defaults to INV (LOT-traceable). */
  state?: StockState;
}

export interface PostingDoc {
  docType?: DocType;
  docId?: string;
  note?: string;
}

export interface PostedLine extends PostingResult {
  itemId: string;
  type: TxnType;
  state: StockState;
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
   * (item, state) bucket, writes the InventoryTxn with a running-balance
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
      const state: StockState = movement.state ?? "INV";
      const item = await tx.inventoryItem.findFirst({
        where: { id: movement.itemId, tenantId },
      });
      if (!item) {
        throw new BadRequestException(`Item ${movement.itemId} not found`);
      }
      const stock = await tx.itemStock.findUnique({
        where: { itemId_state: { itemId: movement.itemId, state } },
      });
      // Fall back to the item's mirrored opening balance for INV when no
      // ItemStock row exists yet (e.g. an item created with an opening qty).
      const position = stock
        ? { quantity: stock.quantity.toString(), avgCost: stock.avgCost.toString() }
        : state === "INV"
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
              `Insufficient ${state} stock for ${item.sku}: have ${err.available}, need ${err.requested}`,
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
          state,
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
        where: { itemId_state: { itemId: movement.itemId, state } },
        create: {
          tenantId,
          itemId: movement.itemId,
          state,
          quantity: result.balanceQty,
          avgCost: result.balanceAvgCost,
        },
        update: { quantity: result.balanceQty, avgCost: result.balanceAvgCost },
      });
      if (state === "INV") {
        await tx.inventoryItem.update({
          where: { id: movement.itemId },
          data: {
            quantityOnHand: result.balanceQty,
            unitCost: result.balanceAvgCost,
          },
        });
      }

      posted.push({ itemId: movement.itemId, type: movement.type, state, ...result });
    }
    return posted;
  }

  /**
   * Move stock between states (e.g. INV -> WIP, or pack-off WIP -> INV). Cost
   * flows with the goods: out at the source average, in at that same cost, so
   * the two ledger lines are value-balanced.
   */
  async transfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
    fromState: StockState,
    toState: StockState,
    quantity: string,
    doc: PostingDoc,
    type: TxnType = "TRANSFER",
  ): Promise<void> {
    const [out] = await this.post(
      tx,
      tenantId,
      [{ itemId, type, direction: "OUT", quantity, state: fromState }],
      doc,
    );
    if (!out) return;
    await this.post(
      tx,
      tenantId,
      [{ itemId, type, direction: "IN", quantity, unitCost: out.unitCost, state: toState }],
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
      state: t.state as StockState,
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

  /** All per-(item, state) positions — drives the WIP vs LOT-traceable report. */
  async getStockPositions(tenantId: string): Promise<StockPosition[]> {
    const rows = await this.prisma.itemStock.findMany({
      where: { tenantId },
      include: { item: true },
      orderBy: [{ state: "asc" }],
    });
    return rows
      .map((r) => ({
        itemId: r.itemId,
        sku: r.item.sku,
        name: r.item.name,
        itemType: r.item.itemType as ItemType,
        state: r.state as StockState,
        quantity: r.quantity.toString(),
        avgCost: r.avgCost.toString(),
        totalValue: extendedValue(r.quantity.toString(), r.avgCost.toString()),
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.state.localeCompare(b.state));
  }
}

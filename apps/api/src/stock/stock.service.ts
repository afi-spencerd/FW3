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

/** One movement to post to the ledger. Magnitudes are positive; direction signs it. */
export interface Movement {
  itemId: string;
  type: TxnType;
  direction: "IN" | "OUT";
  quantity: string;
  /** Required for inbound; outbound costs out at the item's current average. */
  unitCost?: string;
}

export interface PostingDoc {
  docType?: DocType;
  docId?: string;
  note?: string;
}

export interface PostedLine extends PostingResult {
  itemId: string;
  type: TxnType;
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Post a set of movements to the ledger within an existing transaction. For
   * each: re-average (inbound) or cost-out at average (outbound), write the
   * InventoryTxn with running-balance snapshot, and sync the item row. This is
   * the single choke point every document (receipt/production/shipment) goes
   * through, so the ledger and the item position can never diverge.
   */
  async post(
    tx: Prisma.TransactionClient,
    tenantId: string,
    movements: Movement[],
    doc: PostingDoc,
  ): Promise<PostedLine[]> {
    const posted: PostedLine[] = [];
    for (const movement of movements) {
      const item = await tx.inventoryItem.findFirst({
        where: { id: movement.itemId, tenantId },
      });
      if (!item) {
        throw new BadRequestException(`Item ${movement.itemId} not found`);
      }
      const position = {
        quantity: item.quantityOnHand.toString(),
        avgCost: item.unitCost.toString(),
      };

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
              `Insufficient stock for ${item.sku}: have ${err.available}, need ${err.requested}`,
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
      await tx.inventoryItem.update({
        where: { id: movement.itemId },
        data: {
          quantityOnHand: result.balanceQty,
          unitCost: result.balanceAvgCost,
        },
      });

      posted.push({ itemId: movement.itemId, type: movement.type, ...result });
    }
    return posted;
  }

  /** Manual adjustment (opening balances, counts, corrections). */
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
}

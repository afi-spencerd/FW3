import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  ItemType,
  ReorderContainer,
  ReorderItem,
} from "@fw3/shared-types";
import { PrismaService } from "../database/prisma.service";

/**
 * Reorder flags — items / containers whose usable on-hand has fallen below their
 * configured reorder point. Computed live from current stock (self-healing once
 * restocked); nothing is persisted. Raw materials + containers are bought (flag
 * Purchasing); finished goods + bases are produced (flag Scheduling).
 */
@Injectable()
export class ReorderService {
  constructor(private readonly prisma: PrismaService) {}

  /** Raw materials below reorder — replenished by Purchasing. */
  materialsBelowReorder(tenantId: string): Promise<ReorderItem[]> {
    return this.itemsBelowReorder(tenantId, ["RAW_MATERIAL"]);
  }

  /** Produced goods (finished goods + bases) below reorder — replenished by Scheduling. */
  producedBelowReorder(tenantId: string): Promise<ReorderItem[]> {
    return this.itemsBelowReorder(tenantId, ["FINISHED_GOOD", "SEMI_FINISHED"]);
  }

  private async itemsBelowReorder(
    tenantId: string,
    itemTypes: ItemType[],
  ): Promise<ReorderItem[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        tenantId,
        active: true,
        itemType: { in: itemTypes },
        reorderPoint: { not: null },
      },
      include: { stocks: { where: { status: "INV" } } },
      orderBy: { sku: "asc" },
    });
    const out: ReorderItem[] = [];
    for (const item of items) {
      const reorderPoint = item.reorderPoint!; // not-null filtered above
      const onHand = item.stocks[0]?.quantity ?? new Decimal(0);
      if (new Decimal(onHand).lessThan(reorderPoint)) {
        out.push({
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          itemType: item.itemType as ItemType,
          onHand: onHand.toString(),
          reorderPoint: reorderPoint.toString(),
        });
      }
    }
    return out;
  }

  /** Containers below reorder — replenished by Purchasing. */
  async containersBelowReorder(tenantId: string): Promise<ReorderContainer[]> {
    const containers = await this.prisma.container.findMany({
      where: { tenantId, active: true, reorderPoint: { not: null } },
      include: { stock: true },
      orderBy: { sku: "asc" },
    });
    const out: ReorderContainer[] = [];
    for (const c of containers) {
      const reorderPoint = c.reorderPoint!; // not-null filtered above
      const onHand = c.stock?.quantity ?? new Decimal(0);
      if (new Decimal(onHand).lessThan(reorderPoint)) {
        out.push({
          containerId: c.id,
          sku: c.sku,
          name: c.name,
          onHand: onHand.toString(),
          reorderPoint: reorderPoint.toString(),
        });
      }
    }
    return out;
  }
}

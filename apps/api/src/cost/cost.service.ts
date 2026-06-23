import { Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import type { ItemCost } from "@fw3/shared-types";
import { BusinessVariablesService } from "../business-variables/business-variables.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";

type FormulaWithLines = Prisma.FormulaGetPayload<{ include: { lines: true } }>;

export interface CostLineInput {
  itemId: string;
  quantity: string;
  containerId?: string | null;
  containerQuantity?: string | null;
}

export interface LineCost {
  productionUnitCost: string; // per lb (material × factor)
  containerCost: string; // total for the line's containers
  lineCost: string; // qty × productionUnitCost + containerCost
}

/**
 * Cost to produce + pack a sellable item, for sales-order pricing. Material cost
 * is the formula's raw materials rolled up at their moving-average cost (standard
 * cost fallback), times the productionCostFactor business variable; container
 * cost is the line's packaging at its moving-average cost.
 */
@Injectable()
export class CostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessVariables: BusinessVariablesService,
  ) {}

  /** Per-lb material + production cost for an item (excludes container). */
  async itemCost(tenantId: string, itemId: string): Promise<ItemCost> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException("Item not found");

    const material = await this.materialUnitCost(tenantId, itemId);
    const factorStr =
      (await this.businessVariables.getValue(tenantId, "productionCostFactor")) ??
      "1";
    const factor = new Decimal(factorStr || "1");
    const production = material.times(factor);
    return {
      itemId,
      materialUnitCost: material.toDecimalPlaces(4).toString(),
      productionCostFactor: factor.toString(),
      productionUnitCost: production.toDecimalPlaces(4).toString(),
    };
  }

  /** Full cost of a sales-order line (production + containers). */
  async lineCost(tenantId: string, line: CostLineInput): Promise<LineCost> {
    const { productionUnitCost } = await this.itemCost(tenantId, line.itemId);
    const qty = new Decimal(line.quantity || "0");
    const production = new Decimal(productionUnitCost).times(qty);

    let containerCost = new Decimal(0);
    if (line.containerId && line.containerQuantity) {
      const unit = await this.containerUnitCost(tenantId, line.containerId);
      containerCost = unit.times(new Decimal(line.containerQuantity));
    }
    const total = production.plus(containerCost);
    return {
      productionUnitCost,
      containerCost: containerCost.toDecimalPlaces(4).toString(),
      lineCost: total.toDecimalPlaces(4).toString(),
    };
  }

  // ---- internals ----

  /** Σ over the active formula's effective RM fractions of (fraction × unit cost). */
  private async materialUnitCost(
    tenantId: string,
    itemId: string,
  ): Promise<Decimal> {
    const formula = await this.activeFormula(tenantId, itemId);
    if (!formula) {
      // No recipe (e.g. a purchased base): use the item's own on-hand cost.
      return this.itemUnitCost(tenantId, itemId);
    }
    const fractions = new Map<string, Decimal>();
    await this.expand(tenantId, formula, new Decimal(1), fractions, new Set([itemId]));

    const ids = [...fractions.keys()];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids }, tenantId },
      include: { stocks: { where: { status: "INV" } } },
    });
    const costById = new Map(
      items.map((it) => [it.id, this.unitCostOf(it.stocks[0]?.avgCost, it.standardCost)]),
    );
    let total = new Decimal(0);
    for (const [id, frac] of fractions) {
      total = total.plus(frac.times(costById.get(id) ?? new Decimal(0)));
    }
    return total;
  }

  /** An item's own on-hand unit cost (INV avg, else standard). */
  private async itemUnitCost(tenantId: string, itemId: string): Promise<Decimal> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      include: { stocks: { where: { status: "INV" } } },
    });
    if (!item) return new Decimal(0);
    return this.unitCostOf(item.stocks[0]?.avgCost, item.standardCost);
  }

  async containerUnitCost(
    tenantId: string,
    containerId: string,
  ): Promise<Decimal> {
    const container = await this.prisma.container.findFirst({
      where: { id: containerId, tenantId },
      include: { stock: true },
    });
    if (!container) return new Decimal(0);
    return this.unitCostOf(container.stock?.avgCost, container.standardCost);
  }

  /** Prefer a positive moving-average; otherwise the standard cost. */
  private unitCostOf(
    avg: Prisma.Decimal | null | undefined,
    standard: Prisma.Decimal,
  ): Decimal {
    const a = avg ? new Decimal(avg.toString()) : new Decimal(0);
    return a.greaterThan(0) ? a : new Decimal(standard.toString());
  }

  private async activeFormula(
    tenantId: string,
    finishedGoodId: string,
  ): Promise<FormulaWithLines | null> {
    return this.prisma.formula.findFirst({
      where: { tenantId, finishedGoodId },
      include: { lines: true },
      orderBy: [{ isActive: "desc" }, { version: "desc" }],
    });
  }

  /** Accumulate each leaf RM's effective fraction of the finished good (DAG walk). */
  private async expand(
    tenantId: string,
    formula: FormulaWithLines,
    mult: Decimal,
    acc: Map<string, Decimal>,
    path: Set<string>,
  ): Promise<void> {
    const compIds = formula.lines.map((l) => l.rawMaterialId);
    const comps = await this.prisma.inventoryItem.findMany({
      where: { id: { in: compIds }, tenantId },
      select: { id: true, itemType: true },
    });
    const typeById = new Map(comps.map((c) => [c.id, c.itemType]));

    for (const line of formula.lines) {
      const frac = mult.times(new Decimal(line.percentage.toString()).div(100));
      const isBase = typeById.get(line.rawMaterialId) === "SEMI_FINISHED";
      const child =
        isBase && !path.has(line.rawMaterialId)
          ? await this.activeFormula(tenantId, line.rawMaterialId)
          : null;
      if (child) {
        path.add(line.rawMaterialId);
        await this.expand(tenantId, child, frac, acc, path);
        path.delete(line.rawMaterialId);
      } else {
        acc.set(line.rawMaterialId, (acc.get(line.rawMaterialId) ?? new Decimal(0)).plus(frac));
      }
    }
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AuthenticatedUser,
  CompounderInventoryRow,
  CompounderOperator,
  CompounderPour,
  CompounderPourInput,
  CompounderSettableStatus,
  CompounderWorkOrder,
  CompounderWorkOrderSummary,
  ItemType,
  ProductionStatus,
  UnitOfMeasure,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { ProductionService } from "../production/production.service";
import { StockService } from "../stock/stock.service";

type WorkOrderWithRelations = Prisma.ProductionWorkOrderGetPayload<{
  include: {
    target: true;
    formula: { include: { lines: true } };
    lines: { include: { component: true } };
  };
}>;

type PourWithRelations = Prisma.CompounderPourGetPayload<{
  include: { component: true; operator: true };
}>;

@Injectable()
export class CompounderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly production: ProductionService,
  ) {}

  /** The signed-in user the tool is acting as (the operator of record). */
  me(user: AuthenticatedUser): CompounderOperator {
    return { id: user.id, displayName: user.displayName, email: user.email };
  }

  async listWorkOrders(
    tenantId: string,
    status?: ProductionStatus,
  ): Promise<CompounderWorkOrderSummary[]> {
    const rows = await this.prisma.productionWorkOrder.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: { target: true, formula: true, lines: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      workOrderNumber: r.workOrderNumber,
      status: r.status as ProductionStatus,
      targetItemId: r.targetItemId,
      targetSku: r.target.sku,
      targetName: r.target.name,
      formulaName: r.formula.name,
      batchSize: r.batchSize.toString(),
      outputQty: r.outputQty.toString(),
      lineCount: r.lines.length,
    }));
  }

  async getWorkOrder(tenantId: string, id: string): Promise<CompounderWorkOrder> {
    const wo = await this.loadWorkOrder(tenantId, id);
    return this.toWorkOrderDto(tenantId, wo);
  }

  /** Available inventory snapshot (canonical pounds): usable (INV) and WIP. */
  async getInventory(
    tenantId: string,
    query: { search?: string; itemType?: ItemType },
  ): Promise<CompounderInventoryRow[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        tenantId,
        active: true,
        // R&D/lab-only materials are stocked but never exposed to the production
        // dosing tool — only production-use items appear here.
        productionUse: true,
        ...(query.itemType ? { itemType: query.itemType } : {}),
        ...(query.search
          ? {
              OR: [
                { sku: { contains: query.search } },
                { name: { contains: query.search } },
              ],
            }
          : {}),
      },
      include: { stocks: true },
      orderBy: { sku: "asc" },
    });
    return items.map((item) => {
      const inv = item.stocks.find((s) => s.status === "INV");
      const wip = item.stocks.find((s) => s.status === "WIP");
      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        itemType: item.itemType as ItemType,
        handlingUnit: item.unitOfMeasure as UnitOfMeasure,
        invQuantity: (inv?.quantity ?? new Decimal(0)).toString(),
        wipQuantity: (wip?.quantity ?? new Decimal(0)).toString(),
      };
    });
  }

  /**
   * Record a pour: dose `quantity` (lb) of a component into the batch. Pours
   * drive consumption — each posts a CONSUME from WIP — and the first pour moves
   * a STAGED order to IN_PROGRESS. The operator is the authenticated user.
   */
  async recordPour(
    user: AuthenticatedUser,
    workOrderId: string,
    input: CompounderPourInput,
  ): Promise<CompounderPour> {
    const pourId = await this.prisma.$transaction(async (tx) => {
      const wo = await tx.productionWorkOrder.findFirst({
        where: { id: workOrderId, tenantId: user.tenantId },
        include: { lines: true },
      });
      if (!wo) throw new NotFoundException("Work order not found");
      if (wo.status !== "STAGED" && wo.status !== "IN_PROGRESS") {
        throw new BadRequestException(
          `Cannot pour against a ${wo.status} work order (it must be staged or in progress)`,
        );
      }
      const line = wo.lines.find((l) => l.componentId === input.componentId);
      if (!line) {
        throw new BadRequestException(
          "Component is not on this work order's bill of materials",
        );
      }

      // Consume the poured amount from WIP (throws if WIP is short).
      await this.stock.post(
        tx,
        user.tenantId,
        [
          {
            itemId: input.componentId,
            type: "CONSUME",
            direction: "OUT",
            quantity: input.quantity,
            status: "WIP",
          },
        ],
        {
          docType: "PRODUCTION_RUN",
          docId: workOrderId,
          note: `Pour on ${wo.workOrderNumber}`,
        },
      );

      await tx.productionWorkOrderLine.update({
        where: { id: line.id },
        data: { consumedQty: line.consumedQty.plus(new Decimal(input.quantity)) },
      });
      if (wo.status === "STAGED") {
        await tx.productionWorkOrder.update({
          where: { id: wo.id },
          data: { status: "IN_PROGRESS" },
        });
      }

      const pour = await tx.compounderPour.create({
        data: {
          tenantId: user.tenantId,
          productionWorkOrderId: workOrderId,
          workOrderLineId: line.id,
          componentId: input.componentId,
          quantity: input.quantity,
          operatorId: user.id,
          note: input.note ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionWorkOrder",
        entityId: workOrderId,
        action: "UPDATE",
        after: { pour: { ...input, pourId: pour.id } },
      });
      return pour.id;
    });
    return this.getPour(user.tenantId, pourId);
  }

  async listPours(tenantId: string, workOrderId: string): Promise<CompounderPour[]> {
    const rows = await this.prisma.compounderPour.findMany({
      where: { tenantId, productionWorkOrderId: workOrderId },
      include: { component: true, operator: true },
      orderBy: { occurredAt: "desc" },
    });
    return rows.map((r) => this.toPourDto(r));
  }

  /**
   * Set a work order's status from the tool. IN_PROGRESS / ON_HOLD are simple
   * transitions; COMPLETED runs the standard completion (outputs the FG to
   * FG_WIP against the actual poured value and opens its QC lot).
   */
  async setStatus(
    user: AuthenticatedUser,
    workOrderId: string,
    target: CompounderSettableStatus,
  ): Promise<CompounderWorkOrder> {
    if (target === "COMPLETED") {
      await this.production.complete(user, workOrderId);
      return this.getWorkOrder(user.tenantId, workOrderId);
    }

    await this.prisma.$transaction(async (tx) => {
      const wo = await tx.productionWorkOrder.findFirst({
        where: { id: workOrderId, tenantId: user.tenantId },
      });
      if (!wo) throw new NotFoundException("Work order not found");
      const allowed = TRANSITIONS[target];
      if (!allowed.includes(wo.status as ProductionStatus)) {
        throw new BadRequestException(
          `Cannot move a ${wo.status} work order to ${target}`,
        );
      }
      await tx.productionWorkOrder.update({
        where: { id: wo.id },
        data: { status: target },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionWorkOrder",
        entityId: workOrderId,
        action: "UPDATE",
        after: { status: target },
      });
    });
    return this.getWorkOrder(user.tenantId, workOrderId);
  }

  private async getPour(tenantId: string, id: string): Promise<CompounderPour> {
    const row = await this.prisma.compounderPour.findFirst({
      where: { id, tenantId },
      include: { component: true, operator: true },
    });
    if (!row) throw new NotFoundException("Pour not found");
    return this.toPourDto(row);
  }

  private async loadWorkOrder(
    tenantId: string,
    id: string,
  ): Promise<WorkOrderWithRelations> {
    const wo = await this.prisma.productionWorkOrder.findFirst({
      where: { id, tenantId },
      include: {
        target: true,
        formula: { include: { lines: true } },
        lines: { include: { component: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!wo) throw new NotFoundException("Work order not found");
    return wo;
  }

  private async toWorkOrderDto(
    tenantId: string,
    wo: WorkOrderWithRelations,
  ): Promise<CompounderWorkOrder> {
    const pctByComponent = new Map(
      wo.formula.lines.map((l) => [l.rawMaterialId, l.percentage.toString()]),
    );
    const componentIds = wo.lines.map((l) => l.componentId);
    const wipStocks = await this.prisma.itemStock.findMany({
      where: { tenantId, status: "WIP", itemId: { in: componentIds } },
    });
    const wipByItem = new Map(wipStocks.map((s) => [s.itemId, s.quantity.toString()]));

    return {
      id: wo.id,
      workOrderNumber: wo.workOrderNumber,
      status: wo.status as ProductionStatus,
      targetItemId: wo.targetItemId,
      targetSku: wo.target.sku,
      targetName: wo.target.name,
      formulaName: wo.formula.name,
      batchSize: wo.batchSize.toString(),
      outputQty: wo.outputQty.toString(),
      lineCount: wo.lines.length,
      lines: wo.lines.map((line) => ({
        lineId: line.id,
        componentId: line.componentId,
        sku: line.component.sku,
        name: line.component.name,
        handlingUnit: line.component.unitOfMeasure as UnitOfMeasure,
        percentage: pctByComponent.get(line.componentId) ?? "0",
        requiredQty: line.requiredQty.toString(),
        stagedQty: line.stagedQty.toString(),
        consumedQty: line.consumedQty.toString(),
        wipAvailable: wipByItem.get(line.componentId) ?? "0",
      })),
    };
  }

  private toPourDto(row: PourWithRelations): CompounderPour {
    return {
      id: row.id,
      workOrderId: row.productionWorkOrderId,
      workOrderLineId: row.workOrderLineId,
      componentId: row.componentId,
      componentSku: row.component.sku,
      componentName: row.component.name,
      quantity: row.quantity.toString(),
      operator: {
        id: row.operator.id,
        displayName: row.operator.displayName,
        email: row.operator.email,
      },
      note: row.note,
      occurredAt: row.occurredAt.toISOString(),
    };
  }
}

/** Allowed source statuses for the simple (non-completing) transitions. */
const TRANSITIONS: Record<"IN_PROGRESS" | "ON_HOLD", ProductionStatus[]> = {
  IN_PROGRESS: ["STAGED", "ON_HOLD"],
  ON_HOLD: ["STAGED", "IN_PROGRESS"],
};

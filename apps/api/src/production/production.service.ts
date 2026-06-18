import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import {
  type AuthenticatedUser,
  type CreateProductionWorkOrder,
  type ProductionStatus,
  type ProductionWorkOrder,
  type ProductionWorkOrderSummary,
  type PhysicalForm,
  QC_SUITE_BY_FORM,
  type UnitOfMeasure,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FormulaService } from "../formula/formula.service";
import { Prisma } from "../generated/prisma/client";
import { type Movement, StockService } from "../stock/stock.service";
import { rollUpUnitCost } from "./production-math";

type WorkOrderWithRelations = Prisma.ProductionWorkOrderGetPayload<{
  include: {
    target: true;
    formula: true;
    lines: { include: { component: true } };
  };
}>;

@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly formulas: FormulaService,
  ) {}

  async list(tenantId: string): Promise<ProductionWorkOrderSummary[]> {
    const orders = await this.prisma.productionWorkOrder.findMany({
      where: { tenantId },
      include: { target: true, formula: true, lines: { include: { component: true } } },
      orderBy: { createdAt: "desc" },
    });
    return orders.map((o) => {
      const dto = this.toDto(o);
      const { lines, ...summary } = dto;
      return { ...summary, lineCount: lines.length };
    });
  }

  async getById(tenantId: string, id: string): Promise<ProductionWorkOrder> {
    return this.toDto(await this.loadWorkOrder(this.prisma, tenantId, id));
  }

  /** Create a planned work order; expand the formula into component requirements. */
  async create(
    user: AuthenticatedUser,
    input: CreateProductionWorkOrder,
  ): Promise<ProductionWorkOrder> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const target = await tx.inventoryItem.findFirst({
          where: { id: input.targetItemId, tenantId: user.tenantId },
        });
        if (!target) throw new BadRequestException("Target item not found");
        if (target.itemType === "RAW_MATERIAL") {
          throw new BadRequestException(
            `${target.sku} is a raw material and cannot be produced`,
          );
        }
        const formula = await tx.formula.findFirst({
          where: { id: input.formulaId, tenantId: user.tenantId },
        });
        if (!formula) throw new BadRequestException("Formula not found");
        if (formula.finishedGoodId !== input.targetItemId) {
          throw new BadRequestException("Formula does not belong to the target item");
        }

        const requirements = await this.formulas.batchRequirements(
          user.tenantId,
          input.formulaId,
          input.batchSize,
          input.batchUnit,
        );

        const workOrder = await tx.productionWorkOrder.create({
          data: {
            tenantId: user.tenantId,
            workOrderNumber: input.workOrderNumber,
            targetItemId: input.targetItemId,
            formulaId: input.formulaId,
            batchSize: input.batchSize,
            batchUnit: input.batchUnit,
            outputQty: input.outputQty,
            status: "PLANNED",
            notes: input.notes ?? null,
            lines: {
              create: requirements.lines.map((line, index) => ({
                componentId: line.rawMaterialId,
                requiredQty: line.requiredQuantity,
                sortOrder: index,
              })),
            },
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "ProductionWorkOrder",
          entityId: workOrder.id,
          action: "CREATE",
          after: input,
        });
        return workOrder.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.workOrderNumber);
    }
  }

  /** Stage components: move each required quantity INV -> WIP (into refill cans). */
  async stage(user: AuthenticatedUser, id: string): Promise<ProductionWorkOrder> {
    await this.prisma.$transaction(async (tx) => {
      const workOrder = await this.loadWorkOrder(tx, user.tenantId, id);
      if (workOrder.status !== "PLANNED") {
        throw new BadRequestException(`Cannot stage a ${workOrder.status} work order`);
      }
      for (const line of workOrder.lines) {
        await this.stock.transfer(
          tx,
          user.tenantId,
          line.componentId,
          "INV",
          "WIP",
          line.requiredQty.toString(),
          {
            docType: "PRODUCTION_RUN",
            docId: id,
            note: `Work order ${workOrder.workOrderNumber} staging`,
          },
        );
        await tx.productionWorkOrderLine.update({
          where: { id: line.id },
          data: { stagedQty: line.requiredQty },
        });
      }
      await tx.productionWorkOrder.update({ where: { id }, data: { status: "STAGED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionWorkOrder",
        entityId: id,
        action: "UPDATE",
        after: { status: "STAGED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /**
   * Complete: consume staged components from WIP and output the target into
   * FG_WIP at rolled-up cost (consumed value = output value, so it balances).
   */
  async complete(user: AuthenticatedUser, id: string): Promise<ProductionWorkOrder> {
    await this.prisma.$transaction(async (tx) => {
      const workOrder = await this.loadWorkOrder(tx, user.tenantId, id);
      if (workOrder.status !== "STAGED" && workOrder.status !== "IN_PROGRESS") {
        throw new BadRequestException(`Cannot complete a ${workOrder.status} work order`);
      }

      const doc = {
        docType: "PRODUCTION_RUN" as const,
        docId: id,
        note: `Work order ${workOrder.workOrderNumber}`,
      };

      // Components are consumed by the compounder's pours as they happen. If any
      // pours were posted, that consumption already stands — total it from the
      // ledger. Otherwise (completed straight from the app, no tool), consume the
      // staged quantities wholesale, as before. Either way the FG output is cost
      // from the actual consumed value, so the run balances.
      const consumeTxns = await tx.inventoryTxn.findMany({
        where: {
          tenantId: user.tenantId,
          docType: "PRODUCTION_RUN",
          docId: id,
          type: "CONSUME",
        },
        select: { value: true },
      });
      let consumedValue = consumeTxns.reduce(
        (sum, t) => sum.plus(new Decimal(t.value.toString()).abs()),
        new Decimal(0),
      );
      if (consumedValue.isZero()) {
        const consumeMovements: Movement[] = workOrder.lines.map((line) => ({
          itemId: line.componentId,
          type: "CONSUME",
          direction: "OUT",
          quantity: line.stagedQty.toString(),
          status: "WIP",
        }));
        const consumed = await this.stock.post(tx, user.tenantId, consumeMovements, doc);
        consumedValue = consumed.reduce(
          (sum, line) => sum.plus(new Decimal(line.value).abs()),
          new Decimal(0),
        );
        for (const line of workOrder.lines) {
          await tx.productionWorkOrderLine.update({
            where: { id: line.id },
            data: { consumedQty: line.stagedQty },
          });
        }
      }

      const unitCost = rollUpUnitCost(
        consumedValue.toString(),
        workOrder.outputQty.toString(),
      );
      await this.stock.post(
        tx,
        user.tenantId,
        [
          {
            itemId: workOrder.targetItemId,
            type: "PRODUCTION_OUTPUT",
            direction: "IN",
            quantity: workOrder.outputQty.toString(),
            unitCost,
            status: "WIP",
          },
        ],
        doc,
      );

      // Open a PENDING production lot for the output (in FG_WIP). It must pass QC
      // before it can be packed off (FG_WIP -> FG_INV).
      await tx.receivedLot.create({
        data: {
          tenantId: user.tenantId,
          origin: "PRODUCTION",
          itemId: workOrder.targetItemId,
          sourceWorkOrderId: id,
          workOrderNumber: workOrder.workOrderNumber,
          supplierLotNumber: workOrder.workOrderNumber,
          quantity: workOrder.outputQty,
          unitCost,
          qcStatus: "PENDING",
          results: {
            create: QC_SUITE_BY_FORM[
              workOrder.target.physicalForm as PhysicalForm
            ].map((testType) => ({ testType })),
          },
        },
      });

      await tx.productionWorkOrder.update({ where: { id }, data: { status: "COMPLETED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionWorkOrder",
        entityId: id,
        action: "UPDATE",
        after: { status: "COMPLETED", outputUnitCost: unitCost },
      });
    });
    return this.getById(user.tenantId, id);
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<ProductionWorkOrder> {
    await this.prisma.$transaction(async (tx) => {
      const workOrder = await this.loadWorkOrder(tx, user.tenantId, id);
      if (workOrder.status !== "PLANNED") {
        throw new BadRequestException("Only a planned work order can be cancelled");
      }
      await tx.productionWorkOrder.update({ where: { id }, data: { status: "CANCELLED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionWorkOrder",
        entityId: id,
        action: "UPDATE",
        after: { status: "CANCELLED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  private async loadWorkOrder(
    db: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<WorkOrderWithRelations> {
    const workOrder = await db.productionWorkOrder.findFirst({
      where: { id, tenantId },
      include: {
        target: true,
        formula: true,
        lines: { include: { component: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!workOrder) throw new NotFoundException("Production work order not found");
    return workOrder;
  }

  private toDto(workOrder: WorkOrderWithRelations): ProductionWorkOrder {
    return {
      id: workOrder.id,
      tenantId: workOrder.tenantId,
      workOrderNumber: workOrder.workOrderNumber,
      targetItemId: workOrder.targetItemId,
      targetSku: workOrder.target.sku,
      targetName: workOrder.target.name,
      formulaId: workOrder.formulaId,
      formulaName: workOrder.formula.name,
      batchSize: workOrder.batchSize.toString(),
      batchUnit: workOrder.batchUnit as UnitOfMeasure,
      outputQty: workOrder.outputQty.toString(),
      status: workOrder.status as ProductionStatus,
      notes: workOrder.notes,
      lines: workOrder.lines.map((line) => ({
        id: line.id,
        componentId: line.componentId,
        componentSku: line.component.sku,
        componentName: line.component.name,
        handlingUnit: line.component.unitOfMeasure as UnitOfMeasure,
        requiredQty: line.requiredQty.toString(),
        stagedQty: line.stagedQty.toString(),
        consumedQty: line.consumedQty.toString(),
        sortOrder: line.sortOrder,
      })),
      createdAt: workOrder.createdAt.toISOString(),
      updatedAt: workOrder.updatedAt.toISOString(),
    };
  }

  private mapError(err: unknown, workOrderNumber?: string): Error {
    if (err instanceof NotFoundException || err instanceof BadRequestException) {
      return err;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(
        `Production work order "${workOrderNumber}" already exists`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

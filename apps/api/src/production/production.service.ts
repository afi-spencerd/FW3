import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AuthenticatedUser,
  CreateProductionRun,
  ProductionRun,
  ProductionStatus,
  ProductionRunSummary,
  UnitOfMeasure,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FormulaService } from "../formula/formula.service";
import { Prisma } from "../generated/prisma/client";
import { type Movement, StockService } from "../stock/stock.service";
import { rollUpUnitCost } from "./production-math";

type RunWithRelations = Prisma.ProductionRunGetPayload<{
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

  async list(tenantId: string): Promise<ProductionRunSummary[]> {
    const runs = await this.prisma.productionRun.findMany({
      where: { tenantId },
      include: { target: true, formula: true, lines: { include: { component: true } } },
      orderBy: { createdAt: "desc" },
    });
    return runs.map((r) => {
      const dto = this.toDto(r);
      const { lines, ...summary } = dto;
      return { ...summary, lineCount: lines.length };
    });
  }

  async getById(tenantId: string, id: string): Promise<ProductionRun> {
    return this.toDto(await this.loadRun(this.prisma, tenantId, id));
  }

  /** Create a planned run; expand the formula into required component quantities. */
  async create(
    user: AuthenticatedUser,
    input: CreateProductionRun,
  ): Promise<ProductionRun> {
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

        // Expand the formula to absolute component requirements for the batch.
        const requirements = await this.formulas.batchRequirements(
          user.tenantId,
          input.formulaId,
          input.batchSize,
          input.batchUnit,
        );

        const run = await tx.productionRun.create({
          data: {
            tenantId: user.tenantId,
            runNumber: input.runNumber,
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
          entityType: "ProductionRun",
          entityId: run.id,
          action: "CREATE",
          after: input,
        });
        return run.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.runNumber);
    }
  }

  /** Stage components: move each required quantity INV -> WIP (into refill cans). */
  async stage(user: AuthenticatedUser, id: string): Promise<ProductionRun> {
    await this.prisma.$transaction(async (tx) => {
      const run = await this.loadRun(tx, user.tenantId, id);
      if (run.status !== "PLANNED") {
        throw new BadRequestException(`Cannot stage a ${run.status} run`);
      }
      for (const line of run.lines) {
        await this.stock.transfer(
          tx,
          user.tenantId,
          line.componentId,
          "INV",
          "WIP",
          line.requiredQty.toString(),
          { docType: "PRODUCTION_RUN", docId: id, note: `Run ${run.runNumber} staging` },
        );
        await tx.productionRunLine.update({
          where: { id: line.id },
          data: { stagedQty: line.requiredQty },
        });
      }
      await tx.productionRun.update({ where: { id }, data: { status: "STAGED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionRun",
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
  async complete(user: AuthenticatedUser, id: string): Promise<ProductionRun> {
    await this.prisma.$transaction(async (tx) => {
      const run = await this.loadRun(tx, user.tenantId, id);
      if (run.status !== "STAGED") {
        throw new BadRequestException(`Cannot complete a ${run.status} run`);
      }

      const doc = {
        docType: "PRODUCTION_RUN" as const,
        docId: id,
        note: `Run ${run.runNumber}`,
      };
      const consumeMovements: Movement[] = run.lines.map((line) => ({
        itemId: line.componentId,
        type: "CONSUME",
        direction: "OUT",
        quantity: line.stagedQty.toString(),
        state: "WIP",
      }));
      const consumed = await this.stock.post(tx, user.tenantId, consumeMovements, doc);
      const consumedValue = consumed.reduce(
        (sum, line) => sum.plus(new Decimal(line.value).abs()),
        new Decimal(0),
      );

      const unitCost = rollUpUnitCost(consumedValue.toString(), run.outputQty.toString());
      await this.stock.post(
        tx,
        user.tenantId,
        [
          {
            itemId: run.targetItemId,
            type: "PRODUCTION_OUTPUT",
            direction: "IN",
            quantity: run.outputQty.toString(),
            unitCost,
            state: "WIP",
          },
        ],
        doc,
      );

      for (const line of run.lines) {
        await tx.productionRunLine.update({
          where: { id: line.id },
          data: { consumedQty: line.stagedQty },
        });
      }
      await tx.productionRun.update({ where: { id }, data: { status: "COMPLETED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionRun",
        entityId: id,
        action: "UPDATE",
        after: { status: "COMPLETED", outputUnitCost: unitCost },
      });
    });
    return this.getById(user.tenantId, id);
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<ProductionRun> {
    await this.prisma.$transaction(async (tx) => {
      const run = await this.loadRun(tx, user.tenantId, id);
      if (run.status !== "PLANNED") {
        throw new BadRequestException("Only a planned run can be cancelled");
      }
      await tx.productionRun.update({ where: { id }, data: { status: "CANCELLED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ProductionRun",
        entityId: id,
        action: "UPDATE",
        after: { status: "CANCELLED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  private async loadRun(
    db: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<RunWithRelations> {
    const run = await db.productionRun.findFirst({
      where: { id, tenantId },
      include: {
        target: true,
        formula: true,
        lines: { include: { component: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!run) throw new NotFoundException("Production run not found");
    return run;
  }

  private toDto(run: RunWithRelations): ProductionRun {
    return {
      id: run.id,
      tenantId: run.tenantId,
      runNumber: run.runNumber,
      targetItemId: run.targetItemId,
      targetSku: run.target.sku,
      targetName: run.target.name,
      formulaId: run.formulaId,
      formulaName: run.formula.name,
      batchSize: run.batchSize.toString(),
      batchUnit: run.batchUnit as UnitOfMeasure,
      outputQty: run.outputQty.toString(),
      status: run.status as ProductionStatus,
      notes: run.notes,
      lines: run.lines.map((line) => ({
        id: line.id,
        componentId: line.componentId,
        componentSku: line.component.sku,
        componentName: line.component.name,
        stockingUnit: line.component.unitOfMeasure as UnitOfMeasure,
        requiredQty: line.requiredQty.toString(),
        stagedQty: line.stagedQty.toString(),
        consumedQty: line.consumedQty.toString(),
        sortOrder: line.sortOrder,
      })),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private mapError(err: unknown, runNumber?: string): Error {
    if (err instanceof NotFoundException || err instanceof BadRequestException) {
      return err;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(`Production run "${runNumber}" already exists`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

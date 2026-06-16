import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  BatchRequirements,
  CreateFormula,
  Formula,
  FormulaSummary,
  UnitOfMeasure,
  UpdateFormula,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { convertWeight } from "../inventory/units";
import { requiredWeight } from "./formula-math";

type FormulaWithRelations = Prisma.FormulaGetPayload<{
  include: { finishedGood: true; lines: { include: { rawMaterial: true } } };
}>;

@Injectable()
export class FormulaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<FormulaSummary[]> {
    const formulas = await this.prisma.formula.findMany({
      where: { tenantId },
      include: { finishedGood: true, _count: { select: { lines: true } } },
      orderBy: { createdAt: "desc" },
    });
    return formulas.map((f) => ({
      id: f.id,
      tenantId: f.tenantId,
      finishedGoodId: f.finishedGoodId,
      finishedGoodSku: f.finishedGood.sku,
      finishedGoodName: f.finishedGood.name,
      name: f.name,
      version: f.version,
      notes: f.notes,
      isActive: f.isActive,
      lineCount: f._count.lines,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  async getById(tenantId: string, id: string): Promise<Formula> {
    const formula = await this.prisma.formula.findFirst({
      where: { id, tenantId },
      include: {
        finishedGood: true,
        lines: { include: { rawMaterial: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!formula) throw new NotFoundException("Formula not found");
    return this.toDto(formula);
  }

  async create(user: AuthenticatedUser, input: CreateFormula): Promise<Formula> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await this.validateComposition(
          tx,
          user.tenantId,
          input.finishedGoodId,
          input.lines,
        );
        const formula = await tx.formula.create({
          data: {
            tenantId: user.tenantId,
            finishedGoodId: input.finishedGoodId,
            name: input.name,
            version: input.version,
            notes: input.notes ?? null,
            isActive: input.isActive,
            lines: {
              create: input.lines.map((line) => ({
                rawMaterialId: line.rawMaterialId,
                percentage: line.percentage,
                sortOrder: line.sortOrder,
              })),
            },
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Formula",
          entityId: formula.id,
          action: "CREATE",
          after: input,
        });
        return formula.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateFormula,
  ): Promise<Formula> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.formula.findFirst({
          where: { id, tenantId: user.tenantId },
          include: { lines: true },
        });
        if (!existing) throw new NotFoundException("Formula not found");

        await this.validateComposition(
          tx,
          user.tenantId,
          existing.finishedGoodId,
          input.lines,
        );

        // Full replace of lines — simplest correct semantics for an edit.
        await tx.formulaLine.deleteMany({ where: { formulaId: id } });
        await tx.formula.update({
          where: { id },
          data: {
            name: input.name,
            version: input.version,
            notes: input.notes ?? null,
            isActive: input.isActive,
            lines: {
              create: input.lines.map((line) => ({
                rawMaterialId: line.rawMaterialId,
                percentage: line.percentage,
                sortOrder: line.sortOrder,
              })),
            },
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Formula",
          entityId: id,
          action: "UPDATE",
          before: { lines: existing.lines },
          after: input,
        });
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.formula.findFirst({
        where: { id, tenantId: user.tenantId },
      });
      if (!existing) throw new NotFoundException("Formula not found");
      await tx.formulaLine.deleteMany({ where: { formulaId: id } });
      await tx.formula.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "Formula",
        entityId: id,
        action: "DELETE",
        before: existing,
      });
    });
  }

  /**
   * Scale a formula to a batch size, returning each material's required quantity
   * in its own stocking unit. Aggregation is line-wise decimal math (requiredWeight)
   * plus unit conversion — both tested in isolation.
   */
  async batchRequirements(
    tenantId: string,
    id: string,
    batchSize: string,
    unit: UnitOfMeasure,
  ): Promise<BatchRequirements> {
    const formula = await this.prisma.formula.findFirst({
      where: { id, tenantId },
      include: {
        lines: { include: { rawMaterial: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!formula) throw new NotFoundException("Formula not found");

    const lines = formula.lines.map((line) => {
      const weightInBatchUnit = requiredWeight(batchSize, line.percentage.toString());
      const stockingUnit = line.rawMaterial.unitOfMeasure as UnitOfMeasure;
      return {
        rawMaterialId: line.rawMaterialId,
        sku: line.rawMaterial.sku,
        name: line.rawMaterial.name,
        percentage: line.percentage.toString(),
        requiredQuantity: convertWeight(weightInBatchUnit, unit, stockingUnit),
        stockingUnit,
      };
    });

    return { formulaId: id, batchSize, unit, lines };
  }

  /** Enforce domain integrity that the DB can't: item types + tenant ownership. */
  private async validateComposition(
    tx: Prisma.TransactionClient,
    tenantId: string,
    finishedGoodId: string,
    lines: { rawMaterialId: string }[],
  ): Promise<void> {
    const finishedGood = await tx.inventoryItem.findFirst({
      where: { id: finishedGoodId, tenantId },
    });
    if (!finishedGood) {
      throw new BadRequestException("Finished good not found in this tenant");
    }
    if (finishedGood.itemType !== "FINISHED_GOOD") {
      throw new BadRequestException(
        `Formula target ${finishedGood.sku} is not a finished good`,
      );
    }

    const materialIds = lines.map((l) => l.rawMaterialId);
    const materials = await tx.inventoryItem.findMany({
      where: { id: { in: materialIds }, tenantId },
    });
    const byId = new Map(materials.map((m) => [m.id, m]));
    for (const materialId of materialIds) {
      const material = byId.get(materialId);
      if (!material) {
        throw new BadRequestException(`Raw material ${materialId} not found`);
      }
      if (material.itemType !== "RAW_MATERIAL") {
        throw new BadRequestException(`${material.sku} is not a raw material`);
      }
    }
  }

  private toDto(formula: FormulaWithRelations): Formula {
    return {
      id: formula.id,
      tenantId: formula.tenantId,
      finishedGoodId: formula.finishedGoodId,
      finishedGoodSku: formula.finishedGood.sku,
      finishedGoodName: formula.finishedGood.name,
      name: formula.name,
      version: formula.version,
      notes: formula.notes,
      isActive: formula.isActive,
      lines: formula.lines.map((line) => ({
        id: line.id,
        rawMaterialId: line.rawMaterialId,
        rawMaterialSku: line.rawMaterial.sku,
        rawMaterialName: line.rawMaterial.name,
        percentage: line.percentage.toString(),
        sortOrder: line.sortOrder,
      })),
      createdAt: formula.createdAt.toISOString(),
      updatedAt: formula.updatedAt.toISOString(),
    };
  }

  private mapWriteError(err: unknown): Error {
    if (err instanceof NotFoundException || err instanceof BadRequestException) {
      return err;
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return new ConflictException(
        "A formula with this version already exists for the finished good",
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

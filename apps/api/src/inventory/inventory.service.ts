import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  CreateInventoryItem,
  IfraCategory,
  InventoryItem,
  InventoryListQuery,
  ItemType,
  OpeningStock,
  PaginatedInventory,
  PhysicalForm,
  Prop65Status,
  QbItemType,
  UnitOfMeasure,
  UpdateInventoryItem,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { StockService } from "../stock/stock.service";

// Row type as Prisma returns it (Decimal fields are Prisma.Decimal instances),
// with the regulatory IFRA limits included for the DTO.
type InventoryRow = Prisma.InventoryItemGetPayload<{
  include: { ifraLimits: true };
}>;

export interface ValuationSummary {
  itemCount: number;
  totalQuantity: string;
  totalValue: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async list(
    tenantId: string,
    query: InventoryListQuery,
  ): Promise<PaginatedInventory> {
    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      ...(query.itemType === undefined ? {} : { itemType: query.itemType }),
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search } },
              { name: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({
        where,
        include: { ifraLimits: { orderBy: { category: "asc" } } },
        orderBy: { sku: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getById(tenantId: string, id: string): Promise<InventoryItem> {
    const row = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId },
      include: { ifraLimits: { orderBy: { category: "asc" } } },
    });
    if (!row) throw new NotFoundException("Inventory item not found");
    return this.toDto(row);
  }

  async create(
    user: AuthenticatedUser,
    input: CreateInventoryItem,
  ): Promise<InventoryItem> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.inventoryItem.create({
          data: {
            tenantId: user.tenantId,
            sku: input.sku,
            name: input.name,
            description: input.description ?? null,
            itemType: input.itemType,
            physicalForm: input.physicalForm,
            unitOfMeasure: input.unitOfMeasure,
            salesPrice: input.salesPrice,
            qbItemType: input.qbItemType,
            standardCost: input.standardCost,
            purchaseDescription: input.purchaseDescription ?? null,
            incomeAccount: input.incomeAccount ?? null,
            cogsAccount: input.cogsAccount ?? null,
            assetAccount: input.assetAccount ?? null,
            active: input.active,
            reorderPoint: input.reorderPoint ?? null,
            // Raw-material regulatory data.
            productionUse: input.productionUse,
            casNumber: input.casNumber ?? null,
            flashPointC: input.flashPointC ?? null,
            prop65Status: input.prop65Status,
            prop65Notes: input.prop65Notes ?? null,
            ifraLimits: {
              create: input.ifraLimits.map((l) => ({
                tenantId: user.tenantId,
                category: l.category,
                maxPercent: l.maxPercent,
              })),
            },
            // No quantity/cost here — inventory position lives in ItemStock/ledger.
          },
          include: { ifraLimits: { orderBy: { category: "asc" } } },
        });
        // The INV bucket starts empty; opening stock comes from a transaction
        // (an inventory adjustment) posted to the ledger.
        await tx.itemStock.create({
          data: {
            tenantId: user.tenantId,
            itemId: row.id,
            status: "INV",
            quantity: "0",
            avgCost: "0",
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "InventoryItem",
          entityId: row.id,
          action: "CREATE",
          after: this.toDto(row),
        });
        return row;
      });
      return this.toDto(created);
    } catch (err) {
      throw this.mapWriteError(err, input.sku);
    }
  }

  /**
   * Create an item and post its opening balance in one transaction — for stock
   * already on hand that never came through a PO. Creates the item (minimal
   * fields; the rest filled in later on the item page) then posts a single
   * ADJUSTMENT IN at the given cost. No dummy PO required.
   */
  async createWithOpeningBalance(
    user: AuthenticatedUser,
    input: OpeningStock,
  ): Promise<InventoryItem> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const dup = await tx.inventoryItem.findFirst({
          where: { tenantId: user.tenantId, sku: input.sku },
        });
        if (dup) throw new ConflictException(`SKU "${input.sku}" already exists`);

        const row = await tx.inventoryItem.create({
          data: {
            tenantId: user.tenantId,
            sku: input.sku,
            name: input.name,
            itemType: input.itemType,
            physicalForm: input.physicalForm,
            unitOfMeasure: input.unitOfMeasure,
          },
        });
        // Opening IN adjustment (re-averages from zero -> the given unit cost).
        // StockService.post upserts the INV bucket, so no separate 0-bucket needed.
        await this.stock.post(
          tx,
          user.tenantId,
          [
            {
              itemId: row.id,
              type: "ADJUSTMENT",
              direction: "IN",
              quantity: input.quantity,
              unitCost: input.unitCost,
              status: "INV",
            },
          ],
          { docType: "ADJUSTMENT", note: input.note ?? "Opening balance" },
        );
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "InventoryItem",
          entityId: row.id,
          action: "CREATE",
          after: {
            sku: row.sku,
            name: row.name,
            itemType: row.itemType,
            opening: { quantity: input.quantity, unitCost: input.unitCost },
            via: "opening_balance",
          },
        });
        return row.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapWriteError(err, input.sku);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateInventoryItem,
  ): Promise<InventoryItem> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.inventoryItem.findFirst({
          where: { id, tenantId: user.tenantId },
          include: { ifraLimits: { orderBy: { category: "asc" } } },
        });
        if (!existing) throw new NotFoundException("Inventory item not found");

        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.description === undefined
              ? {}
              : { description: input.description ?? null }),
            ...(input.itemType === undefined ? {} : { itemType: input.itemType }),
            ...(input.physicalForm === undefined
              ? {}
              : { physicalForm: input.physicalForm }),
            ...(input.unitOfMeasure === undefined
              ? {}
              : { unitOfMeasure: input.unitOfMeasure }),
            // Quantity / cost are ledger-derived — not on the item master.
            ...(input.salesPrice === undefined
              ? {}
              : { salesPrice: input.salesPrice }),
            ...(input.qbItemType === undefined ? {} : { qbItemType: input.qbItemType }),
            ...(input.standardCost === undefined
              ? {}
              : { standardCost: input.standardCost }),
            ...(input.purchaseDescription === undefined
              ? {}
              : { purchaseDescription: input.purchaseDescription ?? null }),
            ...(input.incomeAccount === undefined
              ? {}
              : { incomeAccount: input.incomeAccount ?? null }),
            ...(input.cogsAccount === undefined
              ? {}
              : { cogsAccount: input.cogsAccount ?? null }),
            ...(input.assetAccount === undefined
              ? {}
              : { assetAccount: input.assetAccount ?? null }),
            ...(input.active === undefined ? {} : { active: input.active }),
            ...(input.reorderPoint === undefined
              ? {}
              : { reorderPoint: input.reorderPoint ?? null }),
            // Raw-material regulatory data.
            ...(input.productionUse === undefined
              ? {}
              : { productionUse: input.productionUse }),
            ...(input.casNumber === undefined
              ? {}
              : { casNumber: input.casNumber ?? null }),
            ...(input.flashPointC === undefined
              ? {}
              : { flashPointC: input.flashPointC ?? null }),
            ...(input.prop65Status === undefined
              ? {}
              : { prop65Status: input.prop65Status }),
            ...(input.prop65Notes === undefined
              ? {}
              : { prop65Notes: input.prop65Notes ?? null }),
          },
        });

        // IFRA limits replace the existing set wholesale when provided.
        if (input.ifraLimits !== undefined) {
          await tx.ifraCategoryLimit.deleteMany({ where: { itemId: existing.id } });
          if (input.ifraLimits.length > 0) {
            await tx.ifraCategoryLimit.createMany({
              data: input.ifraLimits.map((l) => ({
                tenantId: user.tenantId,
                itemId: existing.id,
                category: l.category,
                maxPercent: l.maxPercent,
              })),
            });
          }
        }

        const row = await tx.inventoryItem.findFirstOrThrow({
          where: { id: existing.id },
          include: { ifraLimits: { orderBy: { category: "asc" } } },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "InventoryItem",
          entityId: row.id,
          action: "UPDATE",
          before: this.toDto(existing),
          after: this.toDto(row),
        });
        return row;
      });
      return this.toDto(updated);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  // Inventory items are never hard-deleted — their ledger and audit history must
  // remain intact. To retire an item, set `active = false` via update().

  /**
   * Tenant valuation rollup — read straight from the SQL Server view so the
   * aggregation happens in the database, not by pulling rows into Node.
   */
  async valuation(tenantId: string): Promise<ValuationSummary> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        itemCount: number | bigint;
        totalQuantity: string | number | null;
        totalValue: string | number | null;
      }>
    >(
      Prisma.sql`SELECT itemCount, totalQuantity, totalValue
                 FROM vw_InventoryValuationByTenant
                 WHERE tenantId = ${tenantId}`,
    );

    const row = rows[0];
    return {
      itemCount: Number(row?.itemCount ?? 0),
      totalQuantity: String(row?.totalQuantity ?? "0"),
      totalValue: String(row?.totalValue ?? "0"),
    };
  }

  /** Map a row (with Decimal columns) to the wire DTO (decimals as strings). */
  private toDto(row: InventoryRow): InventoryItem {
    return {
      id: row.id,
      tenantId: row.tenantId,
      sku: row.sku,
      name: row.name,
      description: row.description,
      // DB CHECK constraints guarantee these are within the allowed sets.
      itemType: row.itemType as ItemType,
      physicalForm: row.physicalForm as PhysicalForm,
      unitOfMeasure: row.unitOfMeasure as UnitOfMeasure,
      salesPrice: row.salesPrice.toString(),
      qbItemType: row.qbItemType as QbItemType,
      standardCost: row.standardCost.toString(),
      purchaseDescription: row.purchaseDescription,
      incomeAccount: row.incomeAccount,
      cogsAccount: row.cogsAccount,
      assetAccount: row.assetAccount,
      active: row.active,
      reorderPoint: row.reorderPoint === null ? null : row.reorderPoint.toString(),
      productionUse: row.productionUse,
      casNumber: row.casNumber,
      flashPointC: row.flashPointC === null ? null : row.flashPointC.toString(),
      prop65Status: row.prop65Status as Prop65Status,
      prop65Notes: row.prop65Notes,
      ifraLimits: row.ifraLimits.map((l) => ({
        category: l.category as IfraCategory,
        maxPercent: l.maxPercent.toString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapWriteError(err: unknown, sku?: string): Error {
    if (err instanceof NotFoundException) return err;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return new ConflictException(
        sku ? `SKU "${sku}" already exists` : "Duplicate value",
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

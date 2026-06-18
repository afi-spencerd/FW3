import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  CreateInventoryItem,
  InventoryItem,
  InventoryListQuery,
  ItemType,
  PaginatedInventory,
  PhysicalForm,
  UnitOfMeasure,
  UpdateInventoryItem,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "./valuation";

// Row type as Prisma returns it (Decimal fields are Prisma.Decimal instances).
type InventoryRow = Awaited<
  ReturnType<PrismaService["inventoryItem"]["findFirstOrThrow"]>
>;

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
            active: input.active,
            // quantityOnHand / unitCost default to 0 — they are ledger-derived.
          },
        });
        // The INV bucket starts empty; opening stock comes from a transaction
        // (an inventory adjustment), which posts to the ledger and re-mirrors
        // quantity/cost back onto the item.
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

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateInventoryItem,
  ): Promise<InventoryItem> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.inventoryItem.findFirst({
          where: { id, tenantId: user.tenantId },
        });
        if (!existing) throw new NotFoundException("Inventory item not found");

        const row = await tx.inventoryItem.update({
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
            // quantityOnHand and unitCost are ledger-derived — not editable here.
            ...(input.salesPrice === undefined
              ? {}
              : { salesPrice: input.salesPrice }),
            ...(input.active === undefined ? {} : { active: input.active }),
          },
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
      quantityOnHand: row.quantityOnHand.toString(),
      unitCost: row.unitCost.toString(),
      salesPrice: row.salesPrice.toString(),
      extendedValue: extendedValue(
        row.quantityOnHand.toString(),
        row.unitCost.toString(),
      ),
      active: row.active,
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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AuthenticatedUser,
  CreateCycleCount,
  CycleCount,
  CycleCountLine,
  CycleCountStatus,
  CycleCountSummary,
  LocatedStockStatus,
  RecordCycleCounts,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { type Movement, StockService } from "../stock/stock.service";

type CountWithRelations = Prisma.CycleCountGetPayload<{
  include: {
    scopeLocation: true;
    scopeItem: true;
    lines: { include: { item: true; location: true } };
  };
}>;

@Injectable()
export class CycleCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async list(
    tenantId: string,
    status?: CycleCountStatus,
  ): Promise<CycleCountSummary[]> {
    const rows = await this.prisma.cycleCount.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: {
        scopeLocation: true,
        scopeItem: true,
        lines: { include: { item: true, location: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => {
      const dto = this.toDto(r);
      const { lines, ...summary } = dto;
      return summary;
    });
  }

  async getById(tenantId: string, id: string): Promise<CycleCount> {
    return this.toDto(await this.load(tenantId, id));
  }

  /**
   * Open a count: snapshot a line for every located item currently in scope —
   * a location subtree, a single item across all locations, or the whole tenant.
   * The counter can add found items later.
   */
  async create(
    user: AuthenticatedUser,
    input: CreateCycleCount,
  ): Promise<CycleCount> {
    if (input.scopeLocationId && input.scopeItemId) {
      throw new BadRequestException(
        "A count is scoped by location or by item, not both",
      );
    }
    if (input.scopeItemId) {
      const item = await this.prisma.inventoryItem.findFirst({
        where: { id: input.scopeItemId, tenantId: user.tenantId },
      });
      if (!item) throw new BadRequestException("Scope item not found");
    }
    const leafIds = await this.resolveScopeLeaves(user.tenantId, input.scopeLocationId);
    const reference =
      input.reference?.trim() || `CC-${Date.now().toString(36).toUpperCase()}`;

    const snapshot = await this.prisma.itemStockLocation.findMany({
      where: {
        tenantId: user.tenantId,
        quantity: { gt: 0 },
        ...(input.scopeItemId ? { itemId: input.scopeItemId } : {}),
        ...(leafIds ? { locationId: { in: leafIds } } : {}),
      },
    });

    const id = await this.prisma.$transaction(async (tx) => {
      const count = await tx.cycleCount.create({
        data: {
          tenantId: user.tenantId,
          reference,
          status: "OPEN",
          blind: input.blind,
          scopeLocationId: input.scopeLocationId ?? null,
          scopeItemId: input.scopeItemId ?? null,
          note: input.note ?? null,
          createdById: user.id,
          lines: {
            create: snapshot.map((s) => ({
              tenantId: user.tenantId,
              itemId: s.itemId,
              status: s.status,
              locationId: s.locationId,
              expectedQty: s.quantity,
            })),
          },
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "CycleCount",
        entityId: count.id,
        action: "CREATE",
        after: {
          reference,
          scopeLocationId: input.scopeLocationId,
          scopeItemId: input.scopeItemId,
          blind: input.blind,
        },
      });
      return count.id;
    });
    return this.getById(user.tenantId, id);
  }

  /** Enter counted quantities for snapshot lines and add any found items. */
  async recordCounts(
    user: AuthenticatedUser,
    id: string,
    input: RecordCycleCounts,
  ): Promise<CycleCount> {
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.cycleCount.findFirst({
        where: { id, tenantId: user.tenantId },
        include: { lines: true },
      });
      if (!count) throw new NotFoundException("Cycle count not found");
      if (count.status !== "OPEN") {
        throw new BadRequestException(`Cannot record counts on a ${count.status} cycle count`);
      }
      const lineIds = new Set(count.lines.map((l) => l.id));
      const scopeLeaves = await this.resolveScopeLeaves(
        user.tenantId,
        count.scopeLocationId ?? undefined,
      );
      const inScope = scopeLeaves ? new Set(scopeLeaves) : null; // null = all locations

      for (const entry of input.lines) {
        if (!lineIds.has(entry.lineId)) {
          throw new BadRequestException(`Line ${entry.lineId} is not on this cycle count`);
        }
        await tx.cycleCountLine.update({
          where: { id: entry.lineId },
          data: { countedQty: entry.countedQty, counted: true },
        });
      }

      for (const f of input.found) {
        const [item, location] = await Promise.all([
          tx.inventoryItem.findFirst({ where: { id: f.itemId, tenantId: user.tenantId } }),
          tx.location.findFirst({ where: { id: f.locationId, tenantId: user.tenantId } }),
        ]);
        if (!item) throw new BadRequestException("Found item not found");
        if (!location) throw new BadRequestException("Found location not found");
        if (location.kind !== "RACK" && location.kind !== "AREA") {
          throw new BadRequestException(`${location.name} cannot hold stock`);
        }
        // Item-scoped counts only count the one item (any location); location-scoped
        // counts only count locations within the scope (any item).
        if (count.scopeItemId) {
          if (f.itemId !== count.scopeItemId) {
            throw new BadRequestException("Found item is outside this count's scope");
          }
        } else if (inScope && !inScope.has(f.locationId)) {
          throw new BadRequestException(
            `${location.name} is outside this count's scope`,
          );
        }
        const existing = await tx.itemStockLocation.findUnique({
          where: {
            itemId_status_locationId: {
              itemId: f.itemId,
              status: f.status,
              locationId: f.locationId,
            },
          },
        });
        const expectedQty = existing?.quantity ?? new Decimal(0);
        await tx.cycleCountLine.upsert({
          where: {
            cycleCountId_itemId_status_locationId: {
              cycleCountId: id,
              itemId: f.itemId,
              status: f.status,
              locationId: f.locationId,
            },
          },
          create: {
            tenantId: user.tenantId,
            cycleCountId: id,
            itemId: f.itemId,
            status: f.status,
            locationId: f.locationId,
            expectedQty,
            countedQty: f.countedQty,
            counted: true,
          },
          update: { countedQty: f.countedQty, counted: true },
        });
      }

      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "CycleCount",
        entityId: id,
        action: "UPDATE",
        after: { recorded: input.lines.length, found: input.found.length },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /**
   * Post the count: for each counted line, reconcile the location to the counted
   * amount with an ADJUSTMENT transaction (positive finds enter at the current
   * average cost, so the moving average is unchanged). Uncounted lines are left
   * untouched.
   */
  async post(user: AuthenticatedUser, id: string): Promise<CycleCount> {
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.cycleCount.findFirst({
        where: { id, tenantId: user.tenantId },
        include: { lines: { include: { item: true } } },
      });
      if (!count) throw new NotFoundException("Cycle count not found");
      if (count.status !== "OPEN") {
        throw new BadRequestException(`Cycle count is already ${count.status}`);
      }

      const doc = {
        docType: "ADJUSTMENT" as const,
        docId: id,
        note: `Cycle count ${count.reference}`,
        createdById: user.id,
      };

      for (const line of count.lines) {
        if (!line.counted || line.countedQty === null) continue;
        const status = line.status as LocatedStockStatus;
        const live = await tx.itemStockLocation.findUnique({
          where: {
            itemId_status_locationId: {
              itemId: line.itemId,
              status,
              locationId: line.locationId,
            },
          },
        });
        const liveQty = live?.quantity ?? new Decimal(0);
        const delta = new Decimal(line.countedQty).minus(liveQty);
        if (delta.isZero()) continue;

        if (delta.greaterThan(0)) {
          const bucket = await tx.itemStock.findUnique({
            where: { itemId_status: { itemId: line.itemId, status } },
          });
          const unitCost = (bucket?.avgCost ?? new Decimal(0)).toString();
          const movement: Movement = {
            itemId: line.itemId,
            type: "ADJUSTMENT",
            direction: "IN",
            quantity: delta.toString(),
            unitCost,
            status,
            locationId: line.locationId,
          };
          await this.stock.post(tx, user.tenantId, [movement], doc);
        } else {
          const movement: Movement = {
            itemId: line.itemId,
            type: "ADJUSTMENT",
            direction: "OUT",
            quantity: delta.abs().toString(),
            status,
            locationId: line.locationId,
          };
          await this.stock.post(tx, user.tenantId, [movement], doc);
        }
      }

      await tx.cycleCount.update({
        where: { id },
        data: { status: "COMPLETED", completedById: user.id, completedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "CycleCount",
        entityId: id,
        action: "UPDATE",
        after: { status: "COMPLETED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<CycleCount> {
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.cycleCount.findFirst({
        where: { id, tenantId: user.tenantId },
      });
      if (!count) throw new NotFoundException("Cycle count not found");
      if (count.status !== "OPEN") {
        throw new BadRequestException(`Cannot cancel a ${count.status} cycle count`);
      }
      await tx.cycleCount.update({ where: { id }, data: { status: "CANCELLED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "CycleCount",
        entityId: id,
        action: "UPDATE",
        after: { status: "CANCELLED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /**
   * Stockable leaf locations in scope. null = whole tenant; a leaf returns
   * itself; a building/aisle expands to the racks/areas under it.
   */
  private async resolveScopeLeaves(
    tenantId: string,
    scopeLocationId?: string,
  ): Promise<string[] | null> {
    if (!scopeLocationId) return null;
    const scope = await this.prisma.location.findFirst({
      where: { id: scopeLocationId, tenantId },
    });
    if (!scope) throw new BadRequestException("Scope location not found");
    if (scope.kind === "RACK" || scope.kind === "AREA") return [scope.id];
    const leaves = await this.prisma.location.findMany({
      where: {
        tenantId,
        kind: { in: ["RACK", "AREA"] },
        ...(scope.kind === "BUILDING"
          ? { buildingId: scope.id }
          : { parentId: scope.id }),
      },
      select: { id: true },
    });
    return leaves.map((l) => l.id);
  }

  private async load(tenantId: string, id: string): Promise<CountWithRelations> {
    const count = await this.prisma.cycleCount.findFirst({
      where: { id, tenantId },
      include: {
        scopeLocation: true,
        scopeItem: true,
        lines: {
          include: { item: true, location: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!count) throw new NotFoundException("Cycle count not found");
    return count;
  }

  private toDto(count: CountWithRelations): CycleCount {
    const hideExpected = count.blind && count.status === "OPEN";
    const lines: CycleCountLine[] = count.lines.map((l) => {
      const counted = l.counted && l.countedQty !== null;
      const variance =
        hideExpected || !counted
          ? null
          : new Decimal(l.countedQty as Prisma.Decimal)
              .minus(l.expectedQty)
              .toString();
      return {
        id: l.id,
        itemId: l.itemId,
        sku: l.item.sku,
        name: l.item.name,
        status: l.status as LocatedStockStatus,
        locationId: l.locationId,
        locationCode: l.location.code,
        locationName: l.location.name,
        expectedQty: hideExpected ? null : l.expectedQty.toString(),
        countedQty: l.countedQty === null ? null : l.countedQty.toString(),
        counted,
        variance,
      };
    });

    const countedCount = lines.filter((l) => l.counted).length;
    const varianceCount = hideExpected
      ? 0
      : lines.filter((l) => l.variance !== null && l.variance !== "0").length;

    return {
      id: count.id,
      reference: count.reference,
      status: count.status as CycleCountStatus,
      blind: count.blind,
      scopeLocationId: count.scopeLocationId,
      scopeItemId: count.scopeItemId,
      scopeLabel: count.scopeItem
        ? `${count.scopeItem.sku} — ${count.scopeItem.name} (all locations)`
        : count.scopeLocation
          ? `${count.scopeLocation.code} — ${count.scopeLocation.name}`
          : "All locations",
      note: count.note,
      lineCount: lines.length,
      countedCount,
      varianceCount,
      createdAt: count.createdAt.toISOString(),
      completedAt: count.completedAt ? count.completedAt.toISOString() : null,
      lines,
    };
  }
}

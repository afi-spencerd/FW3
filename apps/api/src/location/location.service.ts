import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  composeLocationCode,
  type CreateLocation,
  type ItemType,
  type LocatedStockStatus,
  type Location as LocationDto,
  type LocationStockRow,
  locationSegment,
  PARENT_KIND,
  rackSide,
  type RackSide,
  type UpdateLocation,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";

type LocationRow = Prisma.LocationGetPayload<object>;

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<LocationDto[]> {
    // Code sorts hierarchically (075 < 075-A < 075-A-100 < 075-RECV), so this
    // groups each building's tree together.
    const rows = await this.prisma.location.findMany({
      where: { tenantId },
      orderBy: [{ code: "asc" }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    user: AuthenticatedUser,
    input: CreateLocation,
  ): Promise<LocationDto> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        // Validate the parent matches the kind's required level and resolve the
        // building ancestor (for code composition + per-building flag scope).
        const expectedParent = PARENT_KIND[input.kind];
        let parent: Prisma.LocationGetPayload<object> | null = null;
        if (expectedParent) {
          parent = await tx.location.findFirst({
            where: { id: input.parentId, tenantId: user.tenantId },
          });
          if (!parent) throw new BadRequestException("Parent location not found");
          if (parent.kind !== expectedParent) {
            throw new BadRequestException(
              `A ${input.kind.toLowerCase()} must sit under ${expectedParent.toLowerCase()}, not ${parent.kind.toLowerCase()}`,
            );
          }
        }

        const segment = locationSegment(input.kind, input.value);
        const code = composeLocationCode(input.kind, parent?.code ?? null, input.value);
        const side: RackSide | null =
          input.kind === "RACK" ? rackSide(Number(input.value)) : null;
        // buildingId: a building is its own; everything else inherits its parent's.
        const buildingId = parent?.buildingId ?? null;

        if (input.isDefault && buildingId)
          await this.clearFlag(tx, user.tenantId, buildingId, "isDefault");
        if (input.isReceiving && buildingId)
          await this.clearFlag(tx, user.tenantId, buildingId, "isReceiving");

        const row = await tx.location.create({
          data: {
            tenantId: user.tenantId,
            kind: input.kind,
            parentId: parent?.id ?? null,
            buildingId,
            name: input.name,
            segment,
            code,
            side,
            isDefault: input.isDefault,
            isReceiving: input.isReceiving,
            active: input.active,
          },
        });
        // A building is the root of its own subtree.
        if (input.kind === "BUILDING") {
          await tx.location.update({
            where: { id: row.id },
            data: { buildingId: row.id },
          });
        }
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Location",
          entityId: row.id,
          action: "CREATE",
          after: { ...input, code },
        });
        return row.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.name);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateLocation,
  ): Promise<LocationDto> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.location.findFirst({
          where: { id, tenantId: user.tenantId },
        });
        if (!existing) throw new NotFoundException("Location not found");
        if ((input.isDefault === true || input.isReceiving === true) &&
            existing.kind !== "RACK" && existing.kind !== "AREA") {
          throw new BadRequestException(
            "Only racks and areas can be default/receiving",
          );
        }
        // Flags are scoped to the building the node belongs to.
        if (input.isDefault === true && existing.buildingId)
          await this.clearFlag(tx, user.tenantId, existing.buildingId, "isDefault", id);
        if (input.isReceiving === true && existing.buildingId)
          await this.clearFlag(tx, user.tenantId, existing.buildingId, "isReceiving", id);
        await tx.location.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.isDefault === undefined
              ? {}
              : { isDefault: input.isDefault }),
            ...(input.isReceiving === undefined
              ? {}
              : { isReceiving: input.isReceiving }),
            ...(input.active === undefined ? {} : { active: input.active }),
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Location",
          entityId: id,
          action: "UPDATE",
          after: input,
        });
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.name);
    }
  }

  /**
   * What's currently sitting in one or more locations (all of them if no ids
   * are given). Located stock only (INV/QUARANTINE); value is at item-level
   * cost. Newest-meaningful ordering: by location, then SKU.
   */
  async getContents(
    tenantId: string,
    locationIds?: string[],
  ): Promise<LocationStockRow[]> {
    const rows = await this.prisma.itemStockLocation.findMany({
      where: {
        tenantId,
        ...(locationIds && locationIds.length
          ? { locationId: { in: locationIds } }
          : {}),
      },
      include: { item: true, location: { include: { building: true } } },
    });
    return rows
      .filter((r) => !r.quantity.isZero())
      .map((r) => ({
        locationId: r.locationId,
        locationName: r.location.name,
        locationCode: r.location.code,
        buildingName: r.location.building?.name ?? null,
        itemId: r.itemId,
        sku: r.item.sku,
        name: r.item.name,
        itemType: r.item.itemType as ItemType,
        status: r.status as LocatedStockStatus,
        quantity: r.quantity.toString(),
        unitCost: r.item.unitCost.toString(),
        totalValue: extendedValue(
          r.quantity.toString(),
          r.item.unitCost.toString(),
        ),
      }))
      .sort(
        (a, b) =>
          a.locationName.localeCompare(b.locationName) ||
          a.sku.localeCompare(b.sku) ||
          a.status.localeCompare(b.status),
      );
  }

  private async getById(tenantId: string, id: string): Promise<LocationDto> {
    const row = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Location not found");
    return this.toDto(row);
  }

  private async clearFlag(
    tx: Prisma.TransactionClient,
    tenantId: string,
    buildingId: string,
    flag: "isDefault" | "isReceiving",
    exceptId?: string,
  ): Promise<void> {
    await tx.location.updateMany({
      where: {
        tenantId,
        buildingId,
        [flag]: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { [flag]: false },
    });
  }

  private toDto(row: LocationRow): LocationDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      kind: row.kind as LocationDto["kind"],
      parentId: row.parentId,
      buildingId: row.buildingId,
      name: row.name,
      segment: row.segment,
      code: row.code,
      side: row.side as RackSide | null,
      isDefault: row.isDefault,
      isReceiving: row.isReceiving,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapError(err: unknown, name?: string): Error {
    if (err instanceof NotFoundException) return err;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return new ConflictException(`Location "${name}" already exists`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  CreateLocation,
  Location as LocationDto,
  UpdateLocation,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";

type LocationRow = Prisma.LocationGetPayload<object>;

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<LocationDto[]> {
    const rows = await this.prisma.location.findMany({
      where: { tenantId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    user: AuthenticatedUser,
    input: CreateLocation,
  ): Promise<LocationDto> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        // At most one default / one receiving per tenant: clear the existing
        // flag before setting it here.
        if (input.isDefault) await this.clearFlag(tx, user.tenantId, "isDefault");
        if (input.isReceiving)
          await this.clearFlag(tx, user.tenantId, "isReceiving");
        const row = await tx.location.create({
          data: {
            tenantId: user.tenantId,
            name: input.name,
            code: input.code ?? null,
            isDefault: input.isDefault,
            isReceiving: input.isReceiving,
            active: input.active,
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Location",
          entityId: row.id,
          action: "CREATE",
          after: input,
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
        if (input.isDefault === true)
          await this.clearFlag(tx, user.tenantId, "isDefault", id);
        if (input.isReceiving === true)
          await this.clearFlag(tx, user.tenantId, "isReceiving", id);
        await tx.location.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.code === undefined ? {} : { code: input.code ?? null }),
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

  private async getById(tenantId: string, id: string): Promise<LocationDto> {
    const row = await this.prisma.location.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Location not found");
    return this.toDto(row);
  }

  private async clearFlag(
    tx: Prisma.TransactionClient,
    tenantId: string,
    flag: "isDefault" | "isReceiving",
    exceptId?: string,
  ): Promise<void> {
    await tx.location.updateMany({
      where: {
        tenantId,
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
      name: row.name,
      code: row.code,
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

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  CreateVendor,
  UpdateVendor,
  Vendor,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";

type VendorRow = Awaited<ReturnType<PrismaService["vendor"]["findFirstOrThrow"]>>;

@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Vendor[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    return vendors.map((v) => this.toDto(v));
  }

  async getById(tenantId: string, id: string): Promise<Vendor> {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, tenantId } });
    if (!vendor) throw new NotFoundException("Vendor not found");
    return this.toDto(vendor);
  }

  async create(user: AuthenticatedUser, input: CreateVendor): Promise<Vendor> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const vendor = await tx.vendor.create({
          data: {
            tenantId: user.tenantId,
            name: input.name,
            code: input.code ?? null,
            email: input.email ?? null,
            isActive: input.isActive,
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Vendor",
          entityId: vendor.id,
          action: "CREATE",
          after: input,
        });
        return vendor;
      });
      return this.toDto(created);
    } catch (err) {
      throw this.mapError(err, input.name);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateVendor,
  ): Promise<Vendor> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.vendor.findFirst({ where: { id, tenantId: user.tenantId } });
        if (!existing) throw new NotFoundException("Vendor not found");
        const vendor = await tx.vendor.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.code === undefined ? {} : { code: input.code ?? null }),
            ...(input.email === undefined ? {} : { email: input.email ?? null }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Vendor",
          entityId: id,
          action: "UPDATE",
          before: existing,
          after: input,
        });
        return vendor;
      });
      return this.toDto(updated);
    } catch (err) {
      throw this.mapError(err, input.name);
    }
  }

  private toDto(v: VendorRow): Vendor {
    return {
      id: v.id,
      tenantId: v.tenantId,
      name: v.name,
      code: v.code,
      email: v.email,
      isActive: v.isActive,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  private mapError(err: unknown, name?: string): Error {
    if (err instanceof NotFoundException) return err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(`Vendor "${name}" already exists`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

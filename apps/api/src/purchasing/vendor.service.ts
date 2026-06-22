import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AddressInput,
  AddressKind,
  AuthenticatedUser,
  ContactInput,
  CreateVendor,
  PaymentTerms,
  UpdateVendor,
  Vendor,
  VendorSupplySummary,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";

type VendorWithRelations = Prisma.VendorGetPayload<{
  include: { addresses: true; contacts: true };
}>;

/** Map a partner address input to row data (parent FK supplied by the nested write). */
function addressData(a: AddressInput, sortOrder: number) {
  return {
    kind: a.kind,
    label: a.label ?? null,
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city ?? null,
    region: a.region ?? null,
    postalCode: a.postalCode ?? null,
    country: a.country ?? null,
    isPrimary: a.isPrimary,
    sortOrder,
  };
}

function contactData(c: ContactInput, sortOrder: number) {
  return {
    name: c.name,
    title: c.title ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    isPrimary: c.isPrimary,
    notes: c.notes ?? null,
    sortOrder,
  };
}

const INCLUDE = {
  addresses: { orderBy: { sortOrder: "asc" } },
  contacts: { orderBy: { sortOrder: "asc" } },
} as const;

@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Vendor[]> {
    const vendors = await this.prisma.vendor.findMany({
      where: { tenantId },
      include: INCLUDE,
      orderBy: { name: "asc" },
    });
    return vendors.map((v) => this.toDto(v));
  }

  /**
   * Per-vendor purchase history derived from non-cancelled POs: how many orders,
   * when we last ordered, and the distinct items / containers each has supplied.
   * Powers "purchased before" and emphasizing vendors for the current lines.
   */
  async supplySummary(tenantId: string): Promise<VendorSupplySummary[]> {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { tenantId, status: { not: "CANCELLED" } },
      select: {
        vendorId: true,
        orderDate: true,
        lines: { select: { itemId: true, containerId: true } },
      },
    });
    const byVendor = new Map<
      string,
      { poCount: number; lastOrderAt: Date | null; items: Set<string>; containers: Set<string> }
    >();
    for (const o of orders) {
      let agg = byVendor.get(o.vendorId);
      if (!agg) {
        agg = { poCount: 0, lastOrderAt: null, items: new Set(), containers: new Set() };
        byVendor.set(o.vendorId, agg);
      }
      agg.poCount += 1;
      if (!agg.lastOrderAt || o.orderDate > agg.lastOrderAt) agg.lastOrderAt = o.orderDate;
      for (const l of o.lines) {
        if (l.itemId) agg.items.add(l.itemId);
        if (l.containerId) agg.containers.add(l.containerId);
      }
    }
    return [...byVendor.entries()].map(([vendorId, agg]) => ({
      vendorId,
      poCount: agg.poCount,
      lastOrderAt: agg.lastOrderAt?.toISOString() ?? null,
      itemIds: [...agg.items],
      containerIds: [...agg.containers],
    }));
  }

  async getById(tenantId: string, id: string): Promise<Vendor> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, tenantId },
      include: INCLUDE,
    });
    if (!vendor) throw new NotFoundException("Vendor not found");
    return this.toDto(vendor);
  }

  async create(user: AuthenticatedUser, input: CreateVendor): Promise<Vendor> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const vendor = await tx.vendor.create({
          data: {
            tenantId: user.tenantId,
            name: input.name,
            code: input.code ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            website: input.website ?? null,
            taxId: input.taxId ?? null,
            paymentTerms: input.paymentTerms ?? null,
            notes: input.notes ?? null,
            isActive: input.isActive,
            suppliesMaterials: input.suppliesMaterials,
            suppliesContainers: input.suppliesContainers,
            addresses: { create: input.addresses.map(addressData) },
            contacts: { create: input.contacts.map(contactData) },
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
        return vendor.id;
      });
      return this.getById(user.tenantId, id);
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
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.vendor.findFirst({
          where: { id, tenantId: user.tenantId },
        });
        if (!existing) throw new NotFoundException("Vendor not found");
        await tx.vendor.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.code === undefined ? {} : { code: input.code ?? null }),
            ...(input.email === undefined ? {} : { email: input.email ?? null }),
            ...(input.phone === undefined ? {} : { phone: input.phone ?? null }),
            ...(input.website === undefined ? {} : { website: input.website ?? null }),
            ...(input.taxId === undefined ? {} : { taxId: input.taxId ?? null }),
            ...(input.paymentTerms === undefined ? {} : { paymentTerms: input.paymentTerms ?? null }),
            ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
            ...(input.suppliesMaterials === undefined
              ? {}
              : { suppliesMaterials: input.suppliesMaterials }),
            ...(input.suppliesContainers === undefined
              ? {}
              : { suppliesContainers: input.suppliesContainers }),
            // Addresses / contacts, when supplied, replace the whole set.
            ...(input.addresses === undefined
              ? {}
              : { addresses: { deleteMany: {}, create: input.addresses.map(addressData) } }),
            ...(input.contacts === undefined
              ? {}
              : { contacts: { deleteMany: {}, create: input.contacts.map(contactData) } }),
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Vendor",
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

  private toDto(v: VendorWithRelations): Vendor {
    return {
      id: v.id,
      tenantId: v.tenantId,
      name: v.name,
      code: v.code,
      email: v.email,
      phone: v.phone,
      website: v.website,
      taxId: v.taxId,
      paymentTerms: v.paymentTerms as PaymentTerms | null,
      notes: v.notes,
      isActive: v.isActive,
      suppliesMaterials: v.suppliesMaterials,
      suppliesContainers: v.suppliesContainers,
      addresses: v.addresses.map((a) => ({
        id: a.id,
        kind: a.kind as AddressKind,
        label: a.label,
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        region: a.region,
        postalCode: a.postalCode,
        country: a.country,
        isPrimary: a.isPrimary,
      })),
      contacts: v.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
        notes: c.notes,
      })),
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

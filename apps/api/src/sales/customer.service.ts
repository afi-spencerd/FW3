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
  CreateCustomer,
  Customer,
  CustomerRating,
  PaymentTerms,
  UpdateCustomer,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";

type CustomerWithRelations = Prisma.CustomerGetPayload<{
  include: { addresses: true; contacts: true };
}>;

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
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Customer[]> {
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      include: INCLUDE,
      orderBy: { name: "asc" },
    });
    return customers.map((c) => this.toDto(c));
  }

  async getById(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: INCLUDE,
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return this.toDto(customer);
  }

  async create(user: AuthenticatedUser, input: CreateCustomer): Promise<Customer> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            tenantId: user.tenantId,
            name: input.name,
            code: input.code ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            website: input.website ?? null,
            taxId: input.taxId ?? null,
            paymentTerms: input.paymentTerms ?? null,
            rating: input.rating ?? null,
            creditLimit: input.creditLimit ?? null,
            notes: input.notes ?? null,
            isActive: input.isActive,
            addresses: { create: input.addresses.map(addressData) },
            contacts: { create: input.contacts.map(contactData) },
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Customer",
          entityId: customer.id,
          action: "CREATE",
          after: input,
        });
        return customer.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.name);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCustomer,
  ): Promise<Customer> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id, tenantId: user.tenantId },
        });
        if (!existing) throw new NotFoundException("Customer not found");
        await tx.customer.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.code === undefined ? {} : { code: input.code ?? null }),
            ...(input.email === undefined ? {} : { email: input.email ?? null }),
            ...(input.phone === undefined ? {} : { phone: input.phone ?? null }),
            ...(input.website === undefined ? {} : { website: input.website ?? null }),
            ...(input.taxId === undefined ? {} : { taxId: input.taxId ?? null }),
            ...(input.paymentTerms === undefined ? {} : { paymentTerms: input.paymentTerms ?? null }),
            ...(input.rating === undefined ? {} : { rating: input.rating ?? null }),
            ...(input.creditLimit === undefined ? {} : { creditLimit: input.creditLimit ?? null }),
            ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
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
          entityType: "Customer",
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

  private toDto(c: CustomerWithRelations): Customer {
    return {
      id: c.id,
      tenantId: c.tenantId,
      name: c.name,
      code: c.code,
      email: c.email,
      phone: c.phone,
      website: c.website,
      taxId: c.taxId,
      paymentTerms: c.paymentTerms as PaymentTerms | null,
      rating: c.rating as CustomerRating | null,
      creditLimit: c.creditLimit?.toString() ?? null,
      notes: c.notes,
      isActive: c.isActive,
      addresses: c.addresses.map((a) => ({
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
      contacts: c.contacts.map((ct) => ({
        id: ct.id,
        name: ct.name,
        title: ct.title,
        email: ct.email,
        phone: ct.phone,
        isPrimary: ct.isPrimary,
        notes: ct.notes,
      })),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private mapError(err: unknown, name?: string): Error {
    if (err instanceof NotFoundException) return err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(`Customer "${name}" already exists`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

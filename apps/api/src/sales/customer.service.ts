import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  CreateCustomer,
  Customer,
  UpdateCustomer,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";

type CustomerRow = Awaited<
  ReturnType<PrismaService["customer"]["findFirstOrThrow"]>
>;

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Customer[]> {
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    return customers.map((c) => this.toDto(c));
  }

  async getById(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return this.toDto(customer);
  }

  async create(user: AuthenticatedUser, input: CreateCustomer): Promise<Customer> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
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
          entityType: "Customer",
          entityId: customer.id,
          action: "CREATE",
          after: input,
        });
        return customer;
      });
      return this.toDto(created);
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
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id, tenantId: user.tenantId },
        });
        if (!existing) throw new NotFoundException("Customer not found");
        const customer = await tx.customer.update({
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
          entityType: "Customer",
          entityId: id,
          action: "UPDATE",
          before: existing,
          after: input,
        });
        return customer;
      });
      return this.toDto(updated);
    } catch (err) {
      throw this.mapError(err, input.name);
    }
  }

  private toDto(c: CustomerRow): Customer {
    return {
      id: c.id,
      tenantId: c.tenantId,
      name: c.name,
      code: c.code,
      email: c.email,
      isActive: c.isActive,
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

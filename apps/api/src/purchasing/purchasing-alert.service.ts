import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AuthenticatedUser,
  CreatePurchasingAlert,
  PurchasingAlert,
  PurchasingAlertStatus,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";

type AlertWithRelations = Prisma.PurchasingAlertGetPayload<{
  include: { item: true; workOrder: true; raisedBy: true };
}>;

@Injectable()
export class PurchasingAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Raise a shortage flag (typically from the scheduler) for purchasing to act on. */
  async create(
    user: AuthenticatedUser,
    input: CreatePurchasingAlert,
  ): Promise<PurchasingAlert> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: input.itemId, tenantId: user.tenantId },
    });
    if (!item) throw new BadRequestException("Item not found");
    if (input.workOrderId) {
      const wo = await this.prisma.productionWorkOrder.findFirst({
        where: { id: input.workOrderId, tenantId: user.tenantId },
      });
      if (!wo) throw new BadRequestException("Work order not found");
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const alert = await tx.purchasingAlert.create({
        data: {
          tenantId: user.tenantId,
          itemId: input.itemId,
          workOrderId: input.workOrderId ?? null,
          shortQty: input.shortQty,
          note: input.note ?? null,
          status: "OPEN",
          raisedById: user.id,
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "PurchasingAlert",
        entityId: alert.id,
        action: "CREATE",
        after: input,
      });
      return alert.id;
    });
    return this.getById(user.tenantId, created);
  }

  async list(
    tenantId: string,
    status?: PurchasingAlertStatus,
  ): Promise<PurchasingAlert[]> {
    const rows = await this.prisma.purchasingAlert.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: { item: true, workOrder: true, raisedBy: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async resolve(user: AuthenticatedUser, id: string): Promise<PurchasingAlert> {
    await this.prisma.$transaction(async (tx) => {
      const alert = await tx.purchasingAlert.findFirst({
        where: { id, tenantId: user.tenantId },
      });
      if (!alert) throw new NotFoundException("Purchasing alert not found");
      if (alert.status === "RESOLVED") return;
      await tx.purchasingAlert.update({
        where: { id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "PurchasingAlert",
        entityId: id,
        action: "UPDATE",
        after: { status: "RESOLVED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  private async getById(tenantId: string, id: string): Promise<PurchasingAlert> {
    const row = await this.prisma.purchasingAlert.findFirst({
      where: { id, tenantId },
      include: { item: true, workOrder: true, raisedBy: true },
    });
    if (!row) throw new NotFoundException("Purchasing alert not found");
    return this.toDto(row);
  }

  private toDto(row: AlertWithRelations): PurchasingAlert {
    return {
      id: row.id,
      tenantId: row.tenantId,
      itemId: row.itemId,
      itemSku: row.item.sku,
      itemName: row.item.name,
      workOrderId: row.workOrderId,
      workOrderNumber: row.workOrder?.workOrderNumber ?? null,
      shortQty: row.shortQty.toString(),
      note: row.note,
      status: row.status as PurchasingAlertStatus,
      raisedByName: row.raisedBy?.displayName ?? null,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }
}

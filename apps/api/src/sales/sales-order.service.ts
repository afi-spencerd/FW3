import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AuthenticatedUser,
  CreateSalesOrder,
  SalesOrder,
  SalesOrderStatus,
  SalesOrderSummary,
  ShipSalesOrder,
  UpdateSalesOrder,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";
import { poStatusFromLines } from "../purchasing/po-status";
import { type Movement, StockService } from "../stock/stock.service";

type SoWithRelations = Prisma.SalesOrderGetPayload<{
  include: { customer: true; lines: { include: { item: true } } };
}>;

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async list(tenantId: string): Promise<SalesOrderSummary[]> {
    const orders = await this.prisma.salesOrder.findMany({
      where: { tenantId },
      include: { customer: true, lines: { include: { item: true } } },
      orderBy: { orderDate: "desc" },
    });
    return orders.map((o) => {
      const dto = this.toDto(o);
      const { lines, ...summary } = dto;
      return { ...summary, lineCount: lines.length };
    });
  }

  async getById(tenantId: string, id: string): Promise<SalesOrder> {
    return this.toDto(await this.loadOrder(this.prisma, tenantId, id));
  }

  async create(
    user: AuthenticatedUser,
    input: CreateSalesOrder,
  ): Promise<SalesOrder> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({
          where: { id: input.customerId, tenantId: user.tenantId },
        });
        if (!customer) throw new BadRequestException("Customer not found");
        await this.assertSellable(tx, user.tenantId, input.lines);

        const order = await tx.salesOrder.create({
          data: {
            tenantId: user.tenantId,
            customerId: input.customerId,
            soNumber: input.soNumber,
            status: "OPEN",
            ...(input.orderDate ? { orderDate: new Date(input.orderDate) } : {}),
            notes: input.notes ?? null,
            lines: {
              create: input.lines.map((line) => ({
                itemId: line.itemId,
                quantityOrdered: line.quantityOrdered,
                unitPrice: line.unitPrice,
                sortOrder: line.sortOrder,
              })),
            },
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "SalesOrder",
          entityId: order.id,
          action: "CREATE",
          after: input,
        });
        return order.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.soNumber);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateSalesOrder,
  ): Promise<SalesOrder> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await this.loadOrder(tx, user.tenantId, id);
        if (existing.status !== "OPEN" || existing.lines.some((l) => l.quantityShipped.greaterThan(0))) {
          throw new BadRequestException(
            "Only an open sales order with no shipments can be edited",
          );
        }
        if (input.lines) await this.assertSellable(tx, user.tenantId, input.lines);
        await tx.salesOrder.update({
          where: { id },
          data: {
            ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
            ...(input.soNumber === undefined ? {} : { soNumber: input.soNumber }),
            ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
            ...(input.lines
              ? {
                  lines: {
                    deleteMany: {},
                    create: input.lines.map((line) => ({
                      itemId: line.itemId,
                      quantityOrdered: line.quantityOrdered,
                      unitPrice: line.unitPrice,
                      sortOrder: line.sortOrder,
                    })),
                  },
                }
              : {}),
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "SalesOrder",
          entityId: id,
          action: "UPDATE",
          before: { status: existing.status },
          after: input,
        });
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.soNumber);
    }
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<SalesOrder> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOrder(tx, user.tenantId, id);
      if (existing.lines.some((l) => l.quantityShipped.greaterThan(0))) {
        throw new BadRequestException("Cannot cancel a sales order with shipments");
      }
      if (existing.status === "CANCELLED") return;
      await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "UPDATE",
        after: { status: "CANCELLED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /**
   * Ship quantities against SO lines: post SHIPMENT movements (out at the item's
   * average cost = COGS, with the no-negative-stock guard), bump shipped
   * quantities, recompute status. One transaction so stock, the SO, and the
   * audit move together.
   */
  async ship(
    user: AuthenticatedUser,
    id: string,
    input: ShipSalesOrder,
  ): Promise<SalesOrder> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrder(tx, user.tenantId, id);
      if (order.status === "CANCELLED" || order.status === "SHIPPED") {
        throw new BadRequestException(`Cannot ship a ${order.status} sales order`);
      }

      const linesById = new Map(order.lines.map((l) => [l.id, l]));
      const movements: Movement[] = [];

      for (const ship of input.lines) {
        const line = linesById.get(ship.salesOrderLineId);
        if (!line) {
          throw new BadRequestException(
            `Line ${ship.salesOrderLineId} is not on this sales order`,
          );
        }
        const remaining = line.quantityOrdered.minus(line.quantityShipped);
        const qty = new Decimal(ship.quantity);
        if (qty.greaterThan(remaining)) {
          throw new BadRequestException(
            `Cannot ship ${qty} of ${line.item.sku}: only ${remaining} remaining on the order`,
          );
        }
        movements.push({
          itemId: line.itemId,
          type: "SHIPMENT",
          direction: "OUT",
          quantity: ship.quantity,
        });
        await tx.salesOrderLine.update({
          where: { id: line.id },
          data: { quantityShipped: line.quantityShipped.plus(qty) },
        });
      }

      // Out at average cost; StockService rejects shipping more than on hand.
      await this.stock.post(tx, user.tenantId, movements, {
        docType: "SALES_ORDER",
        docId: id,
        note: `SO ${order.soNumber} shipment`,
      });

      const refreshed = await tx.salesOrderLine.findMany({
        where: { salesOrderId: id },
      });
      const base = poStatusFromLines(
        refreshed.map((l) => ({
          quantityOrdered: l.quantityOrdered.toString(),
          quantityReceived: l.quantityShipped.toString(),
        })),
      );
      const status = base === "RECEIVED" ? "SHIPPED" : base;
      await tx.salesOrder.update({ where: { id }, data: { status } });

      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "UPDATE",
        after: { shipped: input.lines, status },
      });
    });
    return this.getById(user.tenantId, id);
  }

  private async loadOrder(
    db: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<SoWithRelations> {
    const order = await db.salesOrder.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        lines: { include: { item: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!order) throw new NotFoundException("Sales order not found");
    return order;
  }

  /** Sales lines must be sellable items (finished goods or bases, not raws). */
  private async assertSellable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lines: { itemId: string }[],
  ): Promise<void> {
    const ids = lines.map((l) => l.itemId);
    const items = await tx.inventoryItem.findMany({
      where: { id: { in: ids }, tenantId },
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) throw new BadRequestException(`Item ${id} not found`);
      if (item.itemType === "RAW_MATERIAL") {
        throw new BadRequestException(
          `${item.sku} is a raw material and cannot be sold`,
        );
      }
    }
  }

  private toDto(order: SoWithRelations): SalesOrder {
    const lines = order.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemSku: line.item.sku,
      itemName: line.item.name,
      quantityOrdered: line.quantityOrdered.toString(),
      unitPrice: line.unitPrice.toString(),
      quantityShipped: line.quantityShipped.toString(),
      lineRevenue: extendedValue(
        line.quantityOrdered.toString(),
        line.unitPrice.toString(),
      ),
      sortOrder: line.sortOrder,
    }));
    const totalRevenue = lines
      .reduce((sum, l) => sum.plus(l.lineRevenue), new Decimal(0))
      .toString();
    return {
      id: order.id,
      tenantId: order.tenantId,
      customerId: order.customerId,
      customerName: order.customer.name,
      soNumber: order.soNumber,
      status: order.status as SalesOrderStatus,
      orderDate: order.orderDate.toISOString(),
      notes: order.notes,
      totalRevenue,
      lines,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private mapError(err: unknown, soNumber?: string): Error {
    if (err instanceof NotFoundException || err instanceof BadRequestException) {
      return err;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(`Sales order "${soNumber}" already exists`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

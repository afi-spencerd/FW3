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
  CustomerItemPrice,
  SalesOrder,
  SalesOrderStatus,
  SalesOrderSummary,
  ShipSalesOrder,
  UpdateSalesOrder,
  UpdateShipment,
} from "@fw3/shared-types";
import { PERMISSIONS } from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { ContainerService } from "../container/container.service";
import { CostService } from "../cost/cost.service";
import { PrismaService } from "../database/prisma.service";
import { FormulaService } from "../formula/formula.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";
import { poStatusFromLines } from "../purchasing/po-status";
import { type Movement, StockService } from "../stock/stock.service";

type SoWithRelations = Prisma.SalesOrderGetPayload<{
  include: {
    customer: true;
    lines: { include: { item: true; container: true } };
    shipments: {
      include: { lines: { include: { item: true } }; shippedBy: true };
    };
    workOrders: { include: { target: true } };
  };
}>;

/** Customers on these terms may request production before payment is recorded. */
const NET_TERMS = new Set(["NET_15", "NET_30", "NET_45", "NET_60", "NET_90"]);

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly containers: ContainerService,
    private readonly costs: CostService,
    private readonly formulas: FormulaService,
  ) {}

  /**
   * Block lines priced below cost (qty×price < computed line cost). A user with
   * the price-override permission who opts in (allowBelowCost) may proceed; the
   * override is returned so the caller can audit it. Reads cost live.
   */
  private async assertPricing(
    user: AuthenticatedUser,
    lines: { itemId: string; quantityOrdered: string; unitPrice: string; containerId?: string | null; containerQuantity?: string | null }[],
    allowBelowCost: boolean | undefined,
  ): Promise<{ itemId: string; unitPrice: string; lineCost: string }[]> {
    const violations: { itemId: string; unitPrice: string; lineCost: string }[] = [];
    for (const line of lines) {
      const { lineCost } = await this.costs.lineCost(user.tenantId, {
        itemId: line.itemId,
        quantity: line.quantityOrdered,
        containerId: line.containerId ?? null,
        containerQuantity: line.containerQuantity ?? null,
      });
      const revenue = new Decimal(line.quantityOrdered).times(line.unitPrice);
      if (revenue.lessThan(lineCost)) {
        violations.push({ itemId: line.itemId, unitPrice: line.unitPrice, lineCost });
      }
    }
    if (violations.length === 0) return [];

    const canOverride = user.permissions.includes(PERMISSIONS.SO_PRICE_OVERRIDE);
    if (canOverride && allowBelowCost) return violations; // proceed; caller audits

    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: violations.map((v) => v.itemId) } },
      select: { id: true, sku: true },
    });
    const sku = new Map(items.map((i) => [i.id, i.sku]));
    const detail = violations
      .map((v) => `${sku.get(v.itemId) ?? v.itemId} (cost ${v.lineCost})`)
      .join(", ");
    throw new BadRequestException(
      canOverride
        ? `Lines priced below cost: ${detail}. Set allowBelowCost to override.`
        : `Lines priced below cost: ${detail}. You are not permitted to sell below cost.`,
    );
  }

  async list(tenantId: string): Promise<SalesOrderSummary[]> {
    const orders = await this.prisma.salesOrder.findMany({
      where: { tenantId },
      include: {
        customer: true,
        lines: { include: { item: true, container: true } },
        shipments: {
          include: { lines: { include: { item: true } }, shippedBy: true },
        },
        workOrders: { include: { target: true } },
      },
      orderBy: { orderDate: "desc" },
    });
    return orders.map((o) => {
      const dto = this.toDto(o);
      const { lines, shipments, workOrders, ...summary } = dto;
      return { ...summary, lineCount: lines.length };
    });
  }

  async getById(tenantId: string, id: string): Promise<SalesOrder> {
    return this.toDto(await this.loadOrder(this.prisma, tenantId, id));
  }

  /**
   * Orders awaiting fulfillment — OPEN or PARTIAL, oldest first (ship-first).
   * Returns full orders (with lines) so the shipping desk can act on them
   * directly. SHIPPED and CANCELLED orders have nothing left to ship.
   */
  async listPending(tenantId: string): Promise<SalesOrder[]> {
    const orders = await this.prisma.salesOrder.findMany({
      where: { tenantId, status: { in: ["OPEN", "PARTIAL"] } },
      include: {
        customer: true,
        lines: {
          include: { item: true, container: true },
          orderBy: { sortOrder: "asc" },
        },
        shipments: {
          include: { lines: { include: { item: true } }, shippedBy: true },
          orderBy: { shippedAt: "asc" },
        },
        workOrders: { include: { target: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { orderDate: "asc" },
    });
    return orders.map((o) => this.toDto(o));
  }

  /**
   * What a customer has historically paid per item — quantity-weighted average
   * unit price, the most recent price, and order count, across their
   * non-cancelled sales orders. Powers price suggestions on the SO form.
   */
  async customerPriceHistory(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerItemPrice[]> {
    const lines = await this.prisma.salesOrderLine.findMany({
      where: {
        salesOrder: { tenantId, customerId, status: { not: "CANCELLED" } },
      },
      include: { item: true, salesOrder: { select: { id: true, orderDate: true } } },
    });
    type Agg = {
      sku: string;
      name: string;
      qty: Decimal;
      value: Decimal;
      lastUnitPrice: string;
      lastAt: Date;
      orders: Set<string>;
    };
    const byItem = new Map<string, Agg>();
    for (const l of lines) {
      const qty = new Decimal(l.quantityOrdered.toString());
      const price = l.unitPrice.toString();
      let agg = byItem.get(l.itemId);
      if (!agg) {
        agg = {
          sku: l.item.sku,
          name: l.item.name,
          qty: new Decimal(0),
          value: new Decimal(0),
          lastUnitPrice: price,
          lastAt: l.salesOrder.orderDate,
          orders: new Set(),
        };
        byItem.set(l.itemId, agg);
      }
      agg.qty = agg.qty.plus(qty);
      agg.value = agg.value.plus(qty.times(l.unitPrice.toString()));
      agg.orders.add(l.salesOrder.id);
      if (l.salesOrder.orderDate >= agg.lastAt) {
        agg.lastAt = l.salesOrder.orderDate;
        agg.lastUnitPrice = price;
      }
    }
    return [...byItem.entries()].map(([itemId, a]) => ({
      itemId,
      itemSku: a.sku,
      itemName: a.name,
      avgUnitPrice: a.qty.greaterThan(0)
        ? a.value.div(a.qty).toDecimalPlaces(4).toString()
        : "0",
      lastUnitPrice: a.lastUnitPrice,
      orderCount: a.orders.size,
    }));
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
        const belowCost = await this.assertPricing(user, input.lines, input.allowBelowCost);

        const order = await tx.salesOrder.create({
          data: {
            tenantId: user.tenantId,
            customerId: input.customerId,
            soNumber: input.soNumber,
            status: "OPEN",
            ...(input.orderDate ? { orderDate: new Date(input.orderDate) } : {}),
            ...(input.requestedShipDate
              ? { requestedShipDate: new Date(input.requestedShipDate) }
              : {}),
            notes: input.notes ?? null,
            lines: {
              create: input.lines.map((line) => ({
                itemId: line.itemId,
                quantityOrdered: line.quantityOrdered,
                unitPrice: line.unitPrice,
                sortOrder: line.sortOrder,
                containerId: line.containerId ?? null,
                containerQuantity: line.containerQuantity ?? null,
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
          after: belowCost.length ? { ...input, belowCostOverride: belowCost } : input,
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
        if (input.lines) {
          await this.assertSellable(tx, user.tenantId, input.lines);
          await this.assertPricing(user, input.lines, input.allowBelowCost);
        }
        await tx.salesOrder.update({
          where: { id },
          data: {
            ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
            ...(input.soNumber === undefined ? {} : { soNumber: input.soNumber }),
            ...(input.requestedShipDate === undefined
              ? {}
              : {
                  requestedShipDate: input.requestedShipDate
                    ? new Date(input.requestedShipDate)
                    : null,
                }),
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
                      containerId: line.containerId ?? null,
                      containerQuantity: line.containerQuantity ?? null,
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
      // Keep the ship entries in posting order so we can pair them with the
      // PostedLine results (which carry the cost-of-goods each shipped out at).
      const entries: { line: (typeof order.lines)[number]; qty: string }[] = [];

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
        entries.push({ line, qty: ship.quantity });
        await tx.salesOrderLine.update({
          where: { id: line.id },
          data: { quantityShipped: line.quantityShipped.plus(qty) },
        });
      }

      // Out at average cost; StockService rejects shipping more than on hand.
      // Posted results return in the same order as the movements we built.
      const posted = await this.stock.post(tx, user.tenantId, movements, {
        docType: "SALES_ORDER",
        docId: id,
        note: `SO ${order.soNumber} shipment`,
      });

      // Record the despatch as a first-class shipment, numbered per order.
      const priorShipments = await tx.shipment.count({
        where: { salesOrderId: id },
      });
      const shipmentNumber = `${order.soNumber}-S${priorShipments + 1}`;
      await tx.shipment.create({
        data: {
          tenantId: user.tenantId,
          salesOrderId: id,
          shipmentNumber,
          carrier: input.carrier ?? null,
          trackingNumber: input.trackingNumber ?? null,
          notes: input.notes ?? null,
          shippedById: user.id,
          lines: {
            create: entries.map((entry, i) => ({
              tenantId: user.tenantId,
              salesOrderLineId: entry.line.id,
              itemId: entry.line.itemId,
              quantity: entry.qty,
              // COGS the bucket shipped out at (posted.value is signed -ve OUT).
              unitCost: posted[i]!.unitCost,
              value: new Decimal(posted[i]!.value).abs().toString(),
            })),
          },
        },
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
        after: { shipmentNumber, shipped: input.lines, status },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /** Edit a shipment's carrier / tracking / notes after it has been posted. */
  async updateShipment(
    user: AuthenticatedUser,
    salesOrderId: string,
    shipmentId: string,
    input: UpdateShipment,
  ): Promise<SalesOrder> {
    await this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.findFirst({
        where: { id: shipmentId, salesOrderId, tenantId: user.tenantId },
      });
      if (!shipment) throw new NotFoundException("Shipment not found");
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          ...(input.carrier === undefined ? {} : { carrier: input.carrier ?? null }),
          ...(input.trackingNumber === undefined
            ? {}
            : { trackingNumber: input.trackingNumber ?? null }),
          ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "Shipment",
        entityId: shipmentId,
        action: "UPDATE",
        after: input,
      });
    });
    return this.getById(user.tenantId, salesOrderId);
  }

  /**
   * Pack the order: consume the containers planned on its lines from container
   * inventory (a CONSUME transaction each) and stamp packedAt. Once packing
   * starts the containers are committed (a started container can't be reused),
   * so this is a one-time action — it refuses to run twice or on a cancelled
   * order, and requires at least one line to specify a container.
   */
  async pack(user: AuthenticatedUser, id: string): Promise<SalesOrder> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrder(tx, user.tenantId, id);
      if (order.status === "CANCELLED") {
        throw new BadRequestException("Cannot pack a cancelled sales order");
      }
      if (order.packedAt) {
        throw new BadRequestException("This order has already been packed");
      }
      const entries = order.lines
        .filter((l) => l.containerId && l.containerQuantity)
        .map((l) => ({
          containerId: l.containerId as string,
          quantity: (l.containerQuantity as Prisma.Decimal).toString(),
        }));
      if (entries.length === 0) {
        throw new BadRequestException(
          "No containers selected on this order's lines to pack",
        );
      }

      await this.containers.consumeInTx(tx, user, entries, {
        docType: "SALES_ORDER",
        docId: id,
        note: `Packed SO ${order.soNumber}`,
      });

      await tx.salesOrder.update({
        where: { id },
        data: { packedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "UPDATE",
        after: { packed: entries },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /** Record payment on the order (unblocks requesting production). Idempotent. */
  async markPaid(user: AuthenticatedUser, id: string): Promise<SalesOrder> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrder(tx, user.tenantId, id);
      if (order.status === "CANCELLED") {
        throw new BadRequestException("Cannot mark a cancelled order paid");
      }
      if (order.paidAt) return; // already paid
      await tx.salesOrder.update({ where: { id }, data: { paidAt: new Date() } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "UPDATE",
        after: { paidAt: new Date().toISOString() },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /**
   * Customer-service hand-off to production: create one REQUESTED work order per
   * producible finished-good line (an item with an active formula), linked back
   * to the SO + line. Allowed once the order is paid, or the customer is on net
   * terms. Idempotent — lines already turned into work orders are skipped.
   */
  async requestProduction(
    user: AuthenticatedUser,
    id: string,
  ): Promise<SalesOrder> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrder(tx, user.tenantId, id);
      if (order.status === "CANCELLED") {
        throw new BadRequestException(
          "Cannot request production for a cancelled order",
        );
      }
      const onNetTerms =
        !!order.customer.paymentTerms && NET_TERMS.has(order.customer.paymentTerms);
      if (!order.paidAt && !onNetTerms) {
        throw new BadRequestException(
          "Order must be paid (or the customer on net terms) before requesting production",
        );
      }

      const alreadyRequested = new Set(
        order.workOrders.map((w) => w.salesOrderLineId).filter(Boolean),
      );
      const created: string[] = [];
      for (const line of order.lines) {
        if (alreadyRequested.has(line.id)) continue;
        // Producible = has an active formula for this finished good.
        const formula = await tx.formula.findFirst({
          where: { tenantId: user.tenantId, finishedGoodId: line.itemId, isActive: true },
          orderBy: { version: "desc" },
        });
        if (!formula) continue; // non-producible line (e.g. resold good) — skip
        const batchSize = line.quantityOrdered.toString();
        const requirements = await this.formulas.batchRequirements(
          user.tenantId,
          formula.id,
          batchSize,
          "LB",
        );
        const wo = await tx.productionWorkOrder.create({
          data: {
            tenantId: user.tenantId,
            workOrderNumber: `WO-${order.soNumber}-L${line.sortOrder + 1}`,
            targetItemId: line.itemId,
            formulaId: formula.id,
            batchSize,
            batchUnit: "LB",
            outputQty: batchSize,
            status: "REQUESTED",
            salesOrderId: order.id,
            salesOrderLineId: line.id,
            lines: {
              create: requirements.lines.map((l, index) => ({
                componentId: l.rawMaterialId,
                requiredQty: l.requiredQuantity,
                sortOrder: index,
              })),
            },
          },
        });
        created.push(wo.id);
      }
      if (created.length === 0) {
        throw new BadRequestException(
          "No producible lines to request (already requested, or no active formula)",
        );
      }
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "UPDATE",
        after: { requestedProduction: created },
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
        lines: {
          include: { item: true, container: true },
          orderBy: { sortOrder: "asc" },
        },
        shipments: {
          include: { lines: { include: { item: true } }, shippedBy: true },
          orderBy: { shippedAt: "asc" },
        },
        workOrders: { include: { target: true }, orderBy: { createdAt: "asc" } },
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
      containerId: line.containerId,
      containerSku: line.container?.sku ?? null,
      containerName: line.container?.name ?? null,
      containerQuantity:
        line.containerQuantity === null ? null : line.containerQuantity.toString(),
    }));
    const totalRevenue = lines
      .reduce((sum, l) => sum.plus(l.lineRevenue), new Decimal(0))
      .toString();
    const shipments = order.shipments.map((s) => {
      const sLines = s.lines.map((sl) => ({
        id: sl.id,
        salesOrderLineId: sl.salesOrderLineId,
        itemId: sl.itemId,
        itemSku: sl.item.sku,
        itemName: sl.item.name,
        quantity: sl.quantity.toString(),
        unitCost: sl.unitCost.toString(),
        value: sl.value.toString(),
      }));
      const totalValue = sLines
        .reduce((sum, l) => sum.plus(l.value), new Decimal(0))
        .toString();
      return {
        id: s.id,
        salesOrderId: s.salesOrderId,
        shipmentNumber: s.shipmentNumber,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        notes: s.notes,
        shippedByName: s.shippedBy?.displayName ?? null,
        shippedAt: s.shippedAt.toISOString(),
        lines: sLines,
        totalValue,
      };
    });
    return {
      id: order.id,
      tenantId: order.tenantId,
      customerId: order.customerId,
      customerName: order.customer.name,
      soNumber: order.soNumber,
      status: order.status as SalesOrderStatus,
      orderDate: order.orderDate.toISOString(),
      requestedShipDate: order.requestedShipDate?.toISOString() ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      notes: order.notes,
      totalRevenue,
      packedAt: order.packedAt?.toISOString() ?? null,
      lines,
      shipments,
      workOrders: order.workOrders.map((w) => ({
        id: w.id,
        workOrderNumber: w.workOrderNumber,
        status: w.status,
        targetName: w.target.name,
        salesOrderLineId: w.salesOrderLineId,
      })),
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

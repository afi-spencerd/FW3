import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AuditEntry,
  AuthenticatedUser,
  CreateSalesOrder,
  CustomerItemPrice,
  ImportResultRow,
  ImportSalesOrderRow,
  ImportSalesOrdersResult,
  PaymentMethod,
  PaymentTerms,
  RecordPayment,
  SalesOrder,
  SalesOrderLineInput,
  SalesOrderStatus,
  SalesOrderSummary,
  ShipSalesOrder,
  UpdateSalesOrder,
  UpdateShipment,
} from "@fw3/shared-types";
import { NET_PAYMENT_TERMS, PERMISSIONS } from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { BusinessVariablesService } from "../business-variables/business-variables.service";
import { ContainerService } from "../container/container.service";
import { CostService } from "../cost/cost.service";
import { PrismaService } from "../database/prisma.service";
import { FormulaService } from "../formula/formula.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";
import { poStatusFromLines } from "../purchasing/po-status";
import { StockService } from "../stock/stock.service";

type SoWithRelations = Prisma.SalesOrderGetPayload<{
  include: {
    customer: true;
    lines: { include: { item: true; container: true; productContainer: true } };
    shipments: {
      include: {
        lines: { include: { item: true; container: true } };
        shippedBy: true;
      };
    };
    workOrders: { include: { target: true } };
    payments: { include: { receivedBy: true } };
  };
}>;

/** Customers on these terms may request production before payment is recorded. */
const NET_TERMS = new Set<string>(NET_PAYMENT_TERMS);

/** Default ship-by lead time when sales doesn't specify one (calendar days). */
const DEFAULT_SHIP_LEAD_DAYS = 3;

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly containers: ContainerService,
    private readonly costs: CostService,
    private readonly formulas: FormulaService,
    private readonly businessVars: BusinessVariablesService,
  ) {}

  /**
   * Block lines priced below cost (qty×price < computed line cost). A user with
   * the price-override permission who opts in (allowBelowCost) may proceed; the
   * override is returned so the caller can audit it. Reads cost live.
   */
  private async assertPricing(
    user: AuthenticatedUser,
    lines: SalesOrderLineInput[],
    allowBelowCost: boolean | undefined,
  ): Promise<{ subject: string; unitPrice: string; lineCost: string }[]> {
    const violations: { subject: string; unitPrice: string; lineCost: string }[] = [];
    for (const line of lines) {
      let lineCost: string;
      let subject: string;
      if (line.lineType === "CONTAINER" && line.productContainerId) {
        const unit = await this.costs.containerUnitCost(
          user.tenantId,
          line.productContainerId,
        );
        lineCost = unit.times(new Decimal(line.quantityOrdered)).toDecimalPlaces(4).toString();
        const c = await this.prisma.container.findFirst({
          where: { id: line.productContainerId, tenantId: user.tenantId },
          select: { sku: true },
        });
        subject = c?.sku ?? line.productContainerId;
      } else {
        const lc = await this.costs.lineCost(user.tenantId, {
          itemId: line.itemId!,
          quantity: line.quantityOrdered,
          containerId: line.containerId ?? null,
          containerQuantity: line.containerQuantity ?? null,
        });
        lineCost = lc.lineCost;
        const item = await this.prisma.inventoryItem.findFirst({
          where: { id: line.itemId!, tenantId: user.tenantId },
          select: { sku: true },
        });
        subject = item?.sku ?? line.itemId!;
      }
      const revenue = new Decimal(line.quantityOrdered).times(line.unitPrice);
      if (revenue.lessThan(lineCost)) {
        violations.push({ subject, unitPrice: line.unitPrice, lineCost });
      }
    }
    if (violations.length === 0) return [];

    const canOverride = user.permissions.includes(PERMISSIONS.SO_PRICE_OVERRIDE);
    if (canOverride && allowBelowCost) return violations; // proceed; caller audits

    const detail = violations
      .map((v) => `${v.subject} (cost ${v.lineCost})`)
      .join(", ");
    throw new BadRequestException(
      canOverride
        ? `Lines priced below cost: ${detail}. Set allowBelowCost to override.`
        : `Lines priced below cost: ${detail}. You are not permitted to sell below cost.`,
    );
  }

  /** Map a sales-line input to the DB line create payload, by subject type. */
  private buildLine(line: SalesOrderLineInput) {
    const isContainer = line.lineType === "CONTAINER";
    return {
      lineType: line.lineType ?? "ITEM",
      itemId: isContainer ? null : line.itemId ?? null,
      productContainerId: isContainer ? line.productContainerId ?? null : null,
      quantityOrdered: line.quantityOrdered,
      unitPrice: line.unitPrice,
      sortOrder: line.sortOrder,
      // Packing applies to item lines only.
      containerId: isContainer ? null : line.containerId ?? null,
      containerQuantity: isContainer ? null : line.containerQuantity ?? null,
    };
  }

  async list(tenantId: string): Promise<SalesOrderSummary[]> {
    const orders = await this.prisma.salesOrder.findMany({
      where: { tenantId },
      include: {
        customer: true,
        lines: { include: { item: true, container: true, productContainer: true } },
        shipments: {
          include: { lines: { include: { item: true, container: true } }, shippedBy: true },
        },
        workOrders: { include: { target: true } },
        payments: { include: { receivedBy: true } },
      },
      orderBy: { orderDate: "desc" },
    });
    return orders.map((o) => {
      const dto = this.toDto(o);
      const { lines, shipments, workOrders, payments, ...summary } = dto;
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
          include: { item: true, container: true, productContainer: true },
          orderBy: { sortOrder: "asc" },
        },
        shipments: {
          include: { lines: { include: { item: true, container: true } }, shippedBy: true },
          orderBy: { shippedAt: "asc" },
        },
        workOrders: { include: { target: true }, orderBy: { createdAt: "asc" } },
        payments: { include: { receivedBy: true }, orderBy: { receivedAt: "asc" } },
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
        // Item lines only — container-product lines have no item to key history on.
        itemId: { not: null },
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
      if (!l.itemId || !l.item) continue; // item lines only
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

        // Default the ship-by to a few days after the order date when sales
        // doesn't set one, so every order has a date the scheduler can sequence on.
        const orderDate = input.orderDate ? new Date(input.orderDate) : new Date();
        const requestedShipDate = input.requestedShipDate
          ? new Date(input.requestedShipDate)
          : new Date(orderDate.getTime() + DEFAULT_SHIP_LEAD_DAYS * 86_400_000);

        const order = await tx.salesOrder.create({
          data: {
            tenantId: user.tenantId,
            customerId: input.customerId,
            soNumber: input.soNumber,
            status: "OPEN",
            orderDate,
            requestedShipDate,
            notes: input.notes ?? null,
            lines: { create: input.lines.map((line) => this.buildLine(line)) },
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

  /**
   * Bulk-create sales orders from CSV-derived rows. Rows sharing a soNumber form
   * one order (order-level fields from the first row). Human keys (customer
   * code/name, item / container SKUs) are resolved to ids, then each order is
   * created via create() — reusing all guards. Independent per order: a failure
   * is reported and doesn't abort the batch.
   */
  async importOrders(
    user: AuthenticatedUser,
    rows: ImportSalesOrderRow[],
  ): Promise<ImportSalesOrdersResult> {
    const tenantId = user.tenantId;
    // Resolve the human-readable keys present in the file, in bulk.
    const customerKeys = [...new Set(rows.map((r) => r.customer))];
    const itemSkus = [
      ...new Set(rows.filter((r) => r.lineType !== "CONTAINER").map((r) => r.sku)),
    ];
    const containerSkus = [
      ...new Set([
        ...rows.filter((r) => r.lineType === "CONTAINER").map((r) => r.sku),
        ...rows.map((r) => r.packingSku).filter((v): v is string => !!v),
      ]),
    ];
    const [customers, items, containers] = await Promise.all([
      this.prisma.customer.findMany({
        where: { tenantId, OR: [{ code: { in: customerKeys } }, { name: { in: customerKeys } }] },
        select: { id: true, code: true, name: true },
      }),
      itemSkus.length
        ? this.prisma.inventoryItem.findMany({
            where: { tenantId, sku: { in: itemSkus } },
            select: { id: true, sku: true },
          })
        : Promise.resolve([]),
      containerSkus.length
        ? this.prisma.container.findMany({
            where: { tenantId, sku: { in: containerSkus } },
            select: { id: true, sku: true },
          })
        : Promise.resolve([]),
    ]);
    const customerByCode = new Map(customers.filter((c) => c.code).map((c) => [c.code!, c.id]));
    const customerByName = new Map(customers.map((c) => [c.name, c.id]));
    const itemBySku = new Map(items.map((i) => [i.sku, i.id]));
    const containerBySku = new Map(containers.map((c) => [c.sku, c.id]));

    // Group rows by soNumber, preserving first-seen order.
    const groups: { soNumber: string; rows: ImportSalesOrderRow[] }[] = [];
    const byNumber = new Map<string, (typeof groups)[number]>();
    for (const row of rows) {
      let g = byNumber.get(row.soNumber);
      if (!g) {
        g = { soNumber: row.soNumber, rows: [] };
        byNumber.set(row.soNumber, g);
        groups.push(g);
      }
      g.rows.push(row);
    }

    const results: ImportResultRow[] = [];
    for (const group of groups) {
      const head = group.rows[0]!;
      try {
        const customerId =
          customerByCode.get(head.customer) ?? customerByName.get(head.customer);
        if (!customerId) {
          throw new BadRequestException(`Customer "${head.customer}" not found`);
        }
        const lines = group.rows.map((r, sortOrder) => {
          if (r.lineType === "CONTAINER") {
            const productContainerId = containerBySku.get(r.sku);
            if (!productContainerId) {
              throw new BadRequestException(`Container SKU "${r.sku}" not found`);
            }
            return {
              lineType: "CONTAINER" as const,
              productContainerId,
              quantityOrdered: r.quantity,
              unitPrice: r.unitPrice,
              sortOrder,
            };
          }
          const itemId = itemBySku.get(r.sku);
          if (!itemId) throw new BadRequestException(`Item SKU "${r.sku}" not found`);
          let containerId: string | undefined;
          if (r.packingSku) {
            containerId = containerBySku.get(r.packingSku);
            if (!containerId) {
              throw new BadRequestException(`Packing container SKU "${r.packingSku}" not found`);
            }
          }
          return {
            lineType: "ITEM" as const,
            itemId,
            quantityOrdered: r.quantity,
            unitPrice: r.unitPrice,
            sortOrder,
            containerId,
            containerQuantity: containerId ? r.packingQty : undefined,
          };
        });
        const created = await this.create(user, {
          customerId,
          soNumber: group.soNumber,
          requestedShipDate: this.toIsoDate(head.requestedShipDate),
          notes: head.notes,
          allowBelowCost: group.rows.some((r) => r.allowBelowCost) || undefined,
          lines,
        });
        results.push({
          soNumber: group.soNumber,
          status: "CREATED",
          salesOrderId: created.id,
          lineCount: lines.length,
          error: null,
        });
      } catch (err) {
        results.push({
          soNumber: group.soNumber,
          status: "FAILED",
          salesOrderId: null,
          lineCount: group.rows.length,
          error: err instanceof Error ? err.message : "Import failed",
        });
      }
    }
    return {
      results,
      created: results.filter((r) => r.status === "CREATED").length,
      failed: results.filter((r) => r.status === "FAILED").length,
    };
  }

  /** Accept a plain date (YYYY-MM-DD) or ISO datetime; return ISO, or undefined. */
  private toIsoDate(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid requested ship date "${value}"`);
    }
    return d.toISOString();
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
                    create: input.lines.map((line) => this.buildLine(line)),
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
          before: {
            status: existing.status,
            customerId: existing.customerId,
            soNumber: existing.soNumber,
            requestedShipDate: existing.requestedShipDate?.toISOString() ?? null,
            notes: existing.notes,
            lineCount: existing.lines.length,
          },
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
      // Item lines ship from item INV; container lines draw down container stock.
      // Keep each group in posting order so we can pair with the cost results.
      const itemEntries: { line: (typeof order.lines)[number]; qty: string }[] = [];
      const containerEntries: { line: (typeof order.lines)[number]; qty: string }[] = [];

      for (const ship of input.lines) {
        const line = linesById.get(ship.salesOrderLineId);
        if (!line) {
          throw new BadRequestException(
            `Line ${ship.salesOrderLineId} is not on this sales order`,
          );
        }
        const label = line.item?.sku ?? line.productContainer?.sku ?? line.id;
        const remaining = line.quantityOrdered.minus(line.quantityShipped);
        const qty = new Decimal(ship.quantity);
        if (qty.greaterThan(remaining)) {
          throw new BadRequestException(
            `Cannot ship ${qty} of ${label}: only ${remaining} remaining on the order`,
          );
        }
        if (line.lineType === "CONTAINER") {
          containerEntries.push({ line, qty: ship.quantity });
        } else {
          itemEntries.push({ line, qty: ship.quantity });
        }
        await tx.salesOrderLine.update({
          where: { id: line.id },
          data: { quantityShipped: line.quantityShipped.plus(qty) },
        });
      }

      // Items: OUT at average cost, FIFO-attributed to the FG's INV lots (one
      // ledger line per lot). StockService rejects shipping more than on hand.
      const shipDoc = {
        docType: "SALES_ORDER" as const,
        docId: id,
        note: `SO ${order.soNumber} shipment`,
        createdById: user.id,
      };
      const posted: { unitCost: string; value: string }[] = [];
      for (const entry of itemEntries) {
        posted.push(
          await this.stock.postOutFifo(
            tx,
            user.tenantId,
            { itemId: entry.line.itemId!, type: "SHIPMENT", direction: "OUT", quantity: entry.qty },
            shipDoc,
          ),
        );
      }
      // Containers: OUT at average cost via a SALE movement on the container ledger.
      const containerPosted = await this.containers.sellInTx(
        tx,
        user,
        containerEntries.map((e) => ({
          containerId: e.line.productContainerId!,
          quantity: e.qty,
        })),
        { docType: "SALES_ORDER", docId: id, note: `SO ${order.soNumber} shipment` },
      );

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
            create: [
              ...itemEntries.map((entry, i) => ({
                tenantId: user.tenantId,
                salesOrderLineId: entry.line.id,
                lineType: "ITEM",
                itemId: entry.line.itemId,
                quantity: entry.qty,
                // COGS = sum of the FIFO lot lines (postOutFifo returns it positive).
                unitCost: posted[i]!.unitCost,
                value: posted[i]!.value,
              })),
              ...containerEntries.map((entry, i) => ({
                tenantId: user.tenantId,
                salesOrderLineId: entry.line.id,
                lineType: "CONTAINER",
                containerId: entry.line.productContainerId,
                quantity: entry.qty,
                unitCost: containerPosted[i]!.unitCost,
                value: containerPosted[i]!.value,
              })),
            ],
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

  /**
   * Record a (partial) payment against the order. Credit-card payments add a
   * convenience-fee surcharge (creditCardFeePct, server-computed) on top of the
   * amount — only the amount reduces the balance. The order is auto-marked paid
   * (paidAt) once recorded amounts cover the order total. Overpayment is rejected.
   */
  async recordPayment(
    user: AuthenticatedUser,
    id: string,
    input: RecordPayment,
  ): Promise<SalesOrder> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrder(tx, user.tenantId, id);
      if (order.status === "CANCELLED") {
        throw new BadRequestException("Cannot record a payment on a cancelled order");
      }
      const total = this.orderTotal(order);
      const paid = this.amountPaid(order);
      const balance = total.minus(paid);
      const amount = new Decimal(input.amount);
      if (balance.lessThanOrEqualTo(0)) {
        throw new BadRequestException("Order is already paid in full");
      }
      if (amount.greaterThan(balance)) {
        throw new BadRequestException(
          `Payment ${amount} exceeds the balance due (${balance.toDecimalPlaces(2)})`,
        );
      }

      // Credit-card convenience fee (surcharge on top; not applied to the balance).
      let convenienceFee = new Decimal(0);
      if (input.method === "CREDIT_CARD") {
        const pct = new Decimal(
          (await this.businessVars.getValue(user.tenantId, "creditCardFeePct")) ?? "0",
        );
        convenienceFee = amount.times(pct).div(100).toDecimalPlaces(2);
      }

      await tx.salesOrderPayment.create({
        data: {
          tenantId: user.tenantId,
          salesOrderId: id,
          method: input.method,
          amount: input.amount,
          convenienceFee: convenienceFee.toString(),
          reference: input.reference ?? null,
          note: input.note ?? null,
          receivedById: user.id,
        },
      });

      // Auto-mark paid once cumulative amounts cover the total.
      if (!order.paidAt && paid.plus(amount).greaterThanOrEqualTo(total)) {
        await tx.salesOrder.update({ where: { id }, data: { paidAt: new Date() } });
      }

      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "SalesOrder",
        entityId: id,
        action: "UPDATE",
        after: {
          payment: {
            method: input.method,
            amount: input.amount,
            convenienceFee: convenienceFee.toString(),
            ...(input.reference ? { reference: input.reference } : {}),
          },
        },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /** Sales-order change history (who/what/when), newest first, from the audit log. */
  async history(tenantId: string, id: string): Promise<AuditEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, entityType: "SalesOrder", entityId: id },
      include: { actor: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: r.actor?.displayName ?? null,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private orderTotal(order: SoWithRelations): Decimal {
    return order.lines.reduce(
      (sum, l) => sum.plus(new Decimal(extendedValue(l.quantityOrdered.toString(), l.unitPrice.toString()))),
      new Decimal(0),
    );
  }
  private amountPaid(order: SoWithRelations): Decimal {
    return order.payments.reduce(
      (sum, p) => sum.plus(new Decimal(p.amount.toString())),
      new Decimal(0),
    );
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
        if (!line.itemId) continue; // container-product lines aren't produced
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
          include: { item: true, container: true, productContainer: true },
          orderBy: { sortOrder: "asc" },
        },
        shipments: {
          include: { lines: { include: { item: true, container: true } }, shippedBy: true },
          orderBy: { shippedAt: "asc" },
        },
        workOrders: { include: { target: true }, orderBy: { createdAt: "asc" } },
        payments: { include: { receivedBy: true }, orderBy: { receivedAt: "asc" } },
      },
    });
    if (!order) throw new NotFoundException("Sales order not found");
    return order;
  }

  /**
   * Validate each line's subject exists in this tenant. Any item type is now
   * sellable (raw materials, bases, finished goods); container lines must point
   * at an active container being sold as the product.
   */
  private async assertSellable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lines: SalesOrderLineInput[],
  ): Promise<void> {
    const itemIds = lines
      .filter((l) => l.lineType !== "CONTAINER")
      .map((l) => l.itemId)
      .filter((v): v is string => !!v);
    if (itemIds.length) {
      const items = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds }, tenantId },
      });
      const found = new Set(items.map((i) => i.id));
      for (const id of itemIds) {
        if (!found.has(id)) throw new BadRequestException(`Item ${id} not found`);
      }
    }
    const containerIds = lines
      .filter((l) => l.lineType === "CONTAINER")
      .map((l) => l.productContainerId)
      .filter((v): v is string => !!v);
    if (containerIds.length) {
      const containers = await tx.container.findMany({
        where: { id: { in: containerIds }, tenantId },
      });
      const byId = new Map(containers.map((c) => [c.id, c]));
      for (const id of containerIds) {
        const c = byId.get(id);
        if (!c) throw new BadRequestException(`Container ${id} not found`);
        if (!c.active) {
          throw new BadRequestException(`${c.sku} is inactive and cannot be sold`);
        }
      }
    }
  }

  private toDto(order: SoWithRelations): SalesOrder {
    const lines = order.lines.map((line) => ({
      id: line.id,
      lineType: line.lineType as "ITEM" | "CONTAINER",
      itemId: line.itemId,
      itemSku: line.item?.sku ?? null,
      itemName: line.item?.name ?? null,
      productContainerId: line.productContainerId,
      productContainerSku: line.productContainer?.sku ?? null,
      productContainerName: line.productContainer?.name ?? null,
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
    const totalRevenueDec = lines.reduce(
      (sum, l) => sum.plus(l.lineRevenue),
      new Decimal(0),
    );
    const totalRevenue = totalRevenueDec.toString();
    const amountPaidDec = this.amountPaid(order);
    const amountPaid = amountPaidDec.toString();
    const balanceDue = totalRevenueDec.minus(amountPaidDec).toString();
    const payments = order.payments.map((p) => ({
      id: p.id,
      amount: p.amount.toString(),
      method: p.method as PaymentMethod,
      convenienceFee: p.convenienceFee.toString(),
      reference: p.reference,
      note: p.note,
      receivedByName: p.receivedBy?.displayName ?? null,
      receivedAt: p.receivedAt.toISOString(),
    }));
    const shipments = order.shipments.map((s) => {
      const sLines = s.lines.map((sl) => ({
        id: sl.id,
        salesOrderLineId: sl.salesOrderLineId,
        lineType: sl.lineType as "ITEM" | "CONTAINER",
        itemId: sl.itemId,
        itemSku: sl.item?.sku ?? null,
        itemName: sl.item?.name ?? null,
        containerId: sl.containerId,
        containerSku: sl.container?.sku ?? null,
        containerName: sl.container?.name ?? null,
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
      customerPaymentTerms: order.customer.paymentTerms as PaymentTerms | null,
      soNumber: order.soNumber,
      status: order.status as SalesOrderStatus,
      orderDate: order.orderDate.toISOString(),
      requestedShipDate: order.requestedShipDate?.toISOString() ?? null,
      paidAt: order.paidAt?.toISOString() ?? null,
      notes: order.notes,
      totalRevenue,
      amountPaid,
      balanceDue,
      packedAt: order.packedAt?.toISOString() ?? null,
      lines,
      payments,
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

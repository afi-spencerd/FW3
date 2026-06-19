import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import {
  type AuthenticatedUser,
  type CreatePurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type PhysicalForm,
  type PurchaseOrderSummary,
  QC_SUITE_BY_FORM,
  type ReceivePurchaseOrder,
  type UnitOfMeasure,
  type UpdatePurchaseOrder,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";
import { toPounds, unitCostToPounds } from "../inventory/units";
import { type Movement, StockService } from "../stock/stock.service";
import { poStatusFromLines } from "./po-status";

type PoWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: { vendor: true; lines: { include: { item: true } } };
}>;

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async list(tenantId: string): Promise<PurchaseOrderSummary[]> {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { tenantId },
      include: { vendor: true, lines: { include: { item: true } } },
      orderBy: { orderDate: "desc" },
    });
    return orders.map((o) => {
      const dto = this.toDto(o);
      const { lines, receipts, ...summary } = dto;
      return { ...summary, lineCount: lines.length };
    });
  }

  async getById(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.loadOrder(this.prisma, tenantId, id);
    // Each posted receipt against this PO is a ReceivedLot (origin RECEIPT) —
    // the auditable receiving history, including partials.
    const receipts = await this.prisma.receivedLot.findMany({
      where: { tenantId, purchaseOrderId: id, origin: "RECEIPT" },
      include: { item: true, location: true },
      orderBy: { receivedAt: "asc" },
    });
    return this.toDto(order, receipts);
  }

  async create(
    user: AuthenticatedUser,
    input: CreatePurchaseOrder,
  ): Promise<PurchaseOrder> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const vendor = await tx.vendor.findFirst({
          where: { id: input.vendorId, tenantId: user.tenantId },
        });
        if (!vendor) throw new BadRequestException("Vendor not found");
        await this.assertProcurable(tx, user.tenantId, input.lines);

        const order = await tx.purchaseOrder.create({
          data: {
            tenantId: user.tenantId,
            vendorId: input.vendorId,
            poNumber: input.poNumber,
            status: "OPEN",
            ...(input.orderDate ? { orderDate: new Date(input.orderDate) } : {}),
            notes: input.notes ?? null,
            lines: {
              create: input.lines.map((line) => ({
                itemId: line.itemId,
                quantityOrdered: line.quantityOrdered,
                unitCost: line.unitCost,
                sortOrder: line.sortOrder,
              })),
            },
          },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "PurchaseOrder",
          entityId: order.id,
          action: "CREATE",
          after: input,
        });
        return order.id;
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.poNumber);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdatePurchaseOrder,
  ): Promise<PurchaseOrder> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await this.loadOrder(tx, user.tenantId, id);
        // Only an untouched, open PO can be edited.
        if (existing.status !== "OPEN" || existing.lines.some((l) => l.quantityReceived.greaterThan(0))) {
          throw new BadRequestException(
            "Only an open purchase order with no receipts can be edited",
          );
        }
        if (input.lines) {
          await this.assertProcurable(tx, user.tenantId, input.lines);
        }
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            ...(input.vendorId === undefined ? {} : { vendorId: input.vendorId }),
            ...(input.poNumber === undefined ? {} : { poNumber: input.poNumber }),
            ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
            ...(input.lines
              ? {
                  lines: {
                    deleteMany: {},
                    create: input.lines.map((line) => ({
                      itemId: line.itemId,
                      quantityOrdered: line.quantityOrdered,
                      unitCost: line.unitCost,
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
          entityType: "PurchaseOrder",
          entityId: id,
          action: "UPDATE",
          before: { status: existing.status },
          after: input,
        });
      });
      return this.getById(user.tenantId, id);
    } catch (err) {
      throw this.mapError(err, input.poNumber);
    }
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<PurchaseOrder> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadOrder(tx, user.tenantId, id);
      if (existing.lines.some((l) => l.quantityReceived.greaterThan(0))) {
        throw new BadRequestException("Cannot cancel a purchase order with receipts");
      }
      if (existing.status === "CANCELLED") return;
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "PurchaseOrder",
        entityId: id,
        action: "UPDATE",
        after: { status: "CANCELLED" },
      });
    });
    return this.getById(user.tenantId, id);
  }

  /**
   * Receive quantities against PO lines: post RECEIPT movements (which re-average
   * each item's cost), bump received quantities, recompute status. All in one
   * transaction so stock, the PO, and the audit move together.
   */
  async receive(
    user: AuthenticatedUser,
    id: string,
    input: ReceivePurchaseOrder,
  ): Promise<PurchaseOrder> {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrder(tx, user.tenantId, id);
      if (order.status === "CANCELLED" || order.status === "RECEIVED") {
        throw new BadRequestException(`Cannot receive a ${order.status} purchase order`);
      }

      // Resolve the receiving area: the one requested (must be a receiving
      // location) or the tenant's first. Goods quarantine here; QC approval
      // later routes to this building's default storage.
      let receivingLocationId: string | null = null;
      if (input.locationId) {
        const loc = await tx.location.findFirst({
          where: { id: input.locationId, tenantId: user.tenantId },
        });
        if (!loc) throw new BadRequestException("Receiving location not found");
        if (!loc.isReceiving) {
          throw new BadRequestException(`${loc.name} is not a receiving location`);
        }
        receivingLocationId = loc.id;
      } else {
        const fallback = await tx.location.findFirst({
          where: { tenantId: user.tenantId, isReceiving: true, active: true },
          orderBy: { code: "asc" },
        });
        receivingLocationId = fallback?.id ?? null;
      }

      const linesById = new Map(order.lines.map((l) => [l.id, l]));
      const movements: Movement[] = [];

      for (const recv of input.lines) {
        const line = linesById.get(recv.purchaseOrderLineId);
        if (!line) {
          throw new BadRequestException(
            `Line ${recv.purchaseOrderLineId} is not on this purchase order`,
          );
        }
        // Ordering is in the item's handling unit (kg for kg materials); the
        // remaining check stays in that unit.
        const remaining = line.quantityOrdered.minus(line.quantityReceived);
        const qty = new Decimal(recv.quantity);
        if (qty.greaterThan(remaining)) {
          throw new BadRequestException(
            `Cannot receive ${qty} of ${line.item.sku}: only ${remaining} remaining`,
          );
        }
        // Convert to canonical pounds before it touches stock: a KG material's
        // quantity scales up and its unit cost scales down (total value is kept).
        const handlingUnit = line.item.unitOfMeasure as UnitOfMeasure;
        const qtyLb = toPounds(recv.quantity, handlingUnit);
        const unitCostLb = unitCostToPounds(line.unitCost.toString(), handlingUnit);
        // Received goods land in QUARANTINE at the receiving dock pending QC.
        movements.push({
          itemId: line.itemId,
          type: "RECEIPT",
          direction: "IN",
          quantity: qtyLb,
          unitCost: unitCostLb,
          status: "QUARANTINE",
          ...(receivingLocationId ? { locationId: receivingLocationId } : {}),
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { quantityReceived: line.quantityReceived.plus(qty) },
        });

        // One quarantined lot per received line, with an empty QC test suite.
        const supplierLotNumber =
          recv.supplierLotNumber?.trim() ||
          `${order.poNumber}-${line.item.sku}-${Date.now().toString(36)}`;
        await tx.receivedLot.create({
          data: {
            tenantId: user.tenantId,
            itemId: line.itemId,
            purchaseOrderId: id,
            purchaseOrderLineId: line.id,
            purchaseOrderNumber: order.poNumber,
            vendorName: order.vendor.name,
            supplierLotNumber,
            locationId: receivingLocationId,
            quantity: qtyLb,
            unitCost: unitCostLb,
            qcStatus: "PENDING",
            results: {
              create: QC_SUITE_BY_FORM[line.item.physicalForm as PhysicalForm].map(
                (testType) => ({ testType }),
              ),
            },
          },
        });
      }

      await this.stock.post(tx, user.tenantId, movements, {
        docType: "PURCHASE_ORDER",
        docId: id,
        note: `PO ${order.poNumber} receipt to quarantine`,
      });

      const refreshed = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: id },
      });
      const status = poStatusFromLines(
        refreshed.map((l) => ({
          quantityOrdered: l.quantityOrdered.toString(),
          quantityReceived: l.quantityReceived.toString(),
        })),
      );
      await tx.purchaseOrder.update({ where: { id }, data: { status } });

      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "PurchaseOrder",
        entityId: id,
        action: "UPDATE",
        after: { received: input.lines, status },
      });
    });
    return this.getById(user.tenantId, id);
  }

  private async loadOrder(
    db: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<PoWithRelations> {
    const order = await db.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        vendor: true,
        lines: { include: { item: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!order) throw new NotFoundException("Purchase order not found");
    return order;
  }

  /** PO lines must reference procurable items (raw materials or bases). */
  private async assertProcurable(
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
      if (item.itemType === "FINISHED_GOOD") {
        throw new BadRequestException(
          `${item.sku} is a finished good and cannot be purchased`,
        );
      }
    }
  }

  private toDto(
    order: PoWithRelations,
    receiptRows: Prisma.ReceivedLotGetPayload<{
      include: { item: true; location: true };
    }>[] = [],
  ): PurchaseOrder {
    const lines = order.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemSku: line.item.sku,
      itemName: line.item.name,
      handlingUnit: line.item.unitOfMeasure as UnitOfMeasure,
      quantityOrdered: line.quantityOrdered.toString(),
      unitCost: line.unitCost.toString(),
      quantityReceived: line.quantityReceived.toString(),
      lineValue: extendedValue(
        line.quantityOrdered.toString(),
        line.unitCost.toString(),
      ),
      sortOrder: line.sortOrder,
    }));
    const totalValue = lines
      .reduce((sum, l) => sum.plus(l.lineValue), new Decimal(0))
      .toString();
    const receipts = receiptRows.map((r) => ({
      id: r.id,
      purchaseOrderLineId: r.purchaseOrderLineId,
      itemId: r.itemId,
      itemSku: r.item.sku,
      itemName: r.item.name,
      quantity: r.quantity.toString(),
      unitCost: r.unitCost.toString(),
      lotNumber: r.supplierLotNumber,
      locationCode: r.location?.code ?? null,
      qcStatus: r.qcStatus,
      receivedAt: r.receivedAt.toISOString(),
    }));
    return {
      id: order.id,
      tenantId: order.tenantId,
      vendorId: order.vendorId,
      vendorName: order.vendor.name,
      poNumber: order.poNumber,
      status: order.status as PurchaseOrderStatus,
      orderDate: order.orderDate.toISOString(),
      notes: order.notes,
      totalValue,
      lines,
      receipts,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private mapError(err: unknown, poNumber?: string): Error {
    if (err instanceof NotFoundException || err instanceof BadRequestException) {
      return err;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return new ConflictException(`Purchase order "${poNumber}" already exists`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

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
  type PoNewItem,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type PhysicalForm,
  type PurchaseOrderLineInput,
  type PurchaseOrderSummary,
  QC_SUITE_BY_FORM,
  type ReceivePurchaseOrder,
  type UnitOfMeasure,
  type UpdatePurchaseOrder,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { ContainerService } from "../container/container.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";
import { toPounds, unitCostToPounds } from "../inventory/units";
import { type Movement, StockService } from "../stock/stock.service";
import { poStatusFromLines } from "./po-status";

type PoWithRelations = Prisma.PurchaseOrderGetPayload<{
  include: { vendor: true; lines: { include: { item: true; container: true } } };
}>;

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly containers: ContainerService,
  ) {}

  async list(tenantId: string): Promise<PurchaseOrderSummary[]> {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { tenantId },
      include: { vendor: true, lines: { include: { item: true, container: true } } },
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
    // Container receipts are container-ledger entries tied to this PO (no lot/QC).
    const containerReceipts = await this.prisma.containerTxn.findMany({
      where: { tenantId, docType: "PURCHASE_ORDER", docId: id, type: "ADJUSTMENT" },
      include: { container: true },
      orderBy: { occurredAt: "asc" },
    });
    return this.toDto(order, receipts, containerReceipts);
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
        const lineData = await this.resolveLineData(tx, user, input.lines);

        const order = await tx.purchaseOrder.create({
          data: {
            tenantId: user.tenantId,
            vendorId: input.vendorId,
            poNumber: input.poNumber,
            status: "OPEN",
            ...(input.orderDate ? { orderDate: new Date(input.orderDate) } : {}),
            notes: input.notes ?? null,
            lines: { create: lineData },
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
        let lineData: Awaited<ReturnType<typeof this.resolveLineData>> | null = null;
        if (input.lines) {
          await this.assertProcurable(tx, user.tenantId, input.lines);
          lineData = await this.resolveLineData(tx, user, input.lines);
        }
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            ...(input.vendorId === undefined ? {} : { vendorId: input.vendorId }),
            ...(input.poNumber === undefined ? {} : { poNumber: input.poNumber }),
            ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
            ...(lineData ? { lines: { deleteMany: {}, create: lineData } } : {}),
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
      const containerEntries: {
        containerId: string;
        quantity: string;
        unitCost: string;
      }[] = [];

      for (const recv of input.lines) {
        const line = linesById.get(recv.purchaseOrderLineId);
        if (!line) {
          throw new BadRequestException(
            `Line ${recv.purchaseOrderLineId} is not on this purchase order`,
          );
        }
        const subjectSku = line.item?.sku ?? line.container?.sku ?? "line";
        // Ordering is in the subject's own unit (kg for kg materials, each for
        // containers); the remaining check stays in that unit.
        const remaining = line.quantityOrdered.minus(line.quantityReceived);
        const qty = new Decimal(recv.quantity);
        if (qty.greaterThan(remaining)) {
          throw new BadRequestException(
            `Cannot receive ${qty} of ${subjectSku}: only ${remaining} remaining`,
          );
        }

        if (line.containerId) {
          // Containers are supplies: received straight into container stock at
          // the PO unit cost (re-averaging), no quarantine or QC.
          containerEntries.push({
            containerId: line.containerId,
            quantity: recv.quantity,
            unitCost: line.unitCost.toString(),
          });
        } else {
          const item = line.item!;
          // Convert to canonical pounds before it touches stock: a KG material's
          // quantity scales up and its unit cost scales down (value is kept).
          const handlingUnit = item.unitOfMeasure as UnitOfMeasure;
          const qtyLb = toPounds(recv.quantity, handlingUnit);
          const unitCostLb = unitCostToPounds(line.unitCost.toString(), handlingUnit);
          // One quarantined lot per received line, with an empty QC test suite.
          // Created before the movement so the ledger line carries its lot id.
          const supplierLotNumber =
            recv.supplierLotNumber?.trim() ||
            `${order.poNumber}-${item.sku}-${Date.now().toString(36)}`;
          const lot = await tx.receivedLot.create({
            data: {
              tenantId: user.tenantId,
              itemId: item.id,
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
                create: QC_SUITE_BY_FORM[item.physicalForm as PhysicalForm].map(
                  (testType) => ({ testType }),
                ),
              },
            },
          });
          // Received goods land in QUARANTINE at the receiving dock pending QC.
          movements.push({
            itemId: item.id,
            type: "RECEIPT",
            direction: "IN",
            quantity: qtyLb,
            unitCost: unitCostLb,
            status: "QUARANTINE",
            lotId: lot.id,
            ...(receivingLocationId ? { locationId: receivingLocationId } : {}),
          });
        }

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { quantityReceived: line.quantityReceived.plus(qty) },
        });
      }

      if (movements.length) {
        await this.stock.post(tx, user.tenantId, movements, {
          docType: "PURCHASE_ORDER",
          docId: id,
          note: `PO ${order.poNumber} receipt to quarantine`,
          createdById: user.id,
        });
      }
      if (containerEntries.length) {
        await this.containers.receiveInTx(tx, user, containerEntries, {
          docType: "PURCHASE_ORDER",
          docId: id,
          note: `PO ${order.poNumber} container receipt`,
        });
      }

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
        lines: {
          include: { item: true, container: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!order) throw new NotFoundException("Purchase order not found");
    return order;
  }

  /**
   * Resolve PO line inputs to stored line data, creating any inline `newItem`
   * within the transaction first (so a line that defines a new material ends up
   * referencing the freshly created item).
   */
  private async resolveLineData(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    lines: PurchaseOrderLineInput[],
  ) {
    const out: {
      itemId: string | null;
      containerId: string | null;
      quantityOrdered: string;
      unitCost: string;
      sortOrder: number;
    }[] = [];
    for (const line of lines) {
      const itemId = line.newItem
        ? await this.createItemInline(tx, user, line.newItem)
        : (line.itemId ?? null);
      out.push({
        itemId,
        containerId: line.containerId ?? null,
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
        sortOrder: line.sortOrder,
      });
    }
    return out;
  }

  /** Create a new procurable item inline (opening its INV bucket at zero). */
  private async createItemInline(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    newItem: PoNewItem,
  ): Promise<string> {
    const dup = await tx.inventoryItem.findFirst({
      where: { tenantId: user.tenantId, sku: newItem.sku },
    });
    if (dup) throw new ConflictException(`SKU "${newItem.sku}" already exists`);
    const item = await tx.inventoryItem.create({
      data: {
        tenantId: user.tenantId,
        sku: newItem.sku,
        name: newItem.name,
        itemType: newItem.itemType,
        unitOfMeasure: newItem.unitOfMeasure,
      },
    });
    await tx.itemStock.create({
      data: {
        tenantId: user.tenantId,
        itemId: item.id,
        status: "INV",
        quantity: "0",
        avgCost: "0",
      },
    });
    await this.audit.record(tx, {
      tenantId: user.tenantId,
      actorId: user.id,
      entityType: "InventoryItem",
      entityId: item.id,
      action: "CREATE",
      after: { sku: item.sku, name: item.name, itemType: item.itemType, via: "po" },
    });
    return item.id;
  }

  /**
   * PO lines must reference procurable subjects: items that aren't finished
   * goods (raw materials or bases), or active containers. Each line is one or
   * the other (the schema enforces exactly one).
   */
  private async assertProcurable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lines: { itemId?: string | null; containerId?: string | null }[],
  ): Promise<void> {
    const itemIds = lines.map((l) => l.itemId).filter((v): v is string => !!v);
    if (itemIds.length) {
      const items = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds }, tenantId },
      });
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const id of itemIds) {
        // Any item tier may be purchased (we resell finished goods too); just
        // confirm the item exists in this tenant.
        if (!byId.has(id)) throw new BadRequestException(`Item ${id} not found`);
      }
    }

    const containerIds = lines
      .map((l) => l.containerId)
      .filter((v): v is string => !!v);
    if (containerIds.length) {
      const found = await tx.container.findMany({
        where: { id: { in: containerIds }, tenantId },
      });
      const byId = new Map(found.map((c) => [c.id, c]));
      for (const id of containerIds) {
        if (!byId.has(id)) throw new BadRequestException(`Container ${id} not found`);
      }
    }
  }

  private toDto(
    order: PoWithRelations,
    receiptRows: Prisma.ReceivedLotGetPayload<{
      include: { item: true; location: true };
    }>[] = [],
    containerReceiptRows: Prisma.ContainerTxnGetPayload<{
      include: { container: true };
    }>[] = [],
  ): PurchaseOrder {
    const lines = order.lines.map((line) => {
      const isContainer = line.containerId !== null;
      return {
        id: line.id,
        lineType: (isContainer ? "CONTAINER" : "ITEM") as "ITEM" | "CONTAINER",
        itemId: line.itemId,
        containerId: line.containerId,
        sku: line.item?.sku ?? line.container?.sku ?? "",
        name: line.item?.name ?? line.container?.name ?? "",
        handlingUnit: isContainer
          ? null
          : (line.item!.unitOfMeasure as UnitOfMeasure),
        quantityOrdered: line.quantityOrdered.toString(),
        unitCost: line.unitCost.toString(),
        quantityReceived: line.quantityReceived.toString(),
        lineValue: extendedValue(
          line.quantityOrdered.toString(),
          line.unitCost.toString(),
        ),
        sortOrder: line.sortOrder,
      };
    });
    const totalValue = lines
      .reduce((sum, l) => sum.plus(l.lineValue), new Decimal(0))
      .toString();
    const itemReceipts = receiptRows.map((r) => ({
      id: r.id,
      lineType: "ITEM" as const,
      purchaseOrderLineId: r.purchaseOrderLineId,
      subjectId: r.itemId as string,
      sku: r.item.sku,
      name: r.item.name,
      quantity: r.quantity.toString(),
      unitCost: r.unitCost.toString(),
      lotNumber: r.supplierLotNumber,
      locationCode: r.location?.code ?? null,
      qcStatus: r.qcStatus,
      receivedAt: r.receivedAt.toISOString(),
    }));
    const containerReceipts = containerReceiptRows.map((t) => ({
      id: t.id,
      lineType: "CONTAINER" as const,
      purchaseOrderLineId: null,
      subjectId: t.containerId,
      sku: t.container.sku,
      name: t.container.name,
      quantity: t.quantity.toString(),
      unitCost: t.unitCost.toString(),
      lotNumber: null,
      locationCode: null,
      qcStatus: null,
      receivedAt: t.occurredAt.toISOString(),
    }));
    const receipts = [...itemReceipts, ...containerReceipts].sort((a, b) =>
      a.receivedAt.localeCompare(b.receivedAt),
    );
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

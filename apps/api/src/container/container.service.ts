import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AdjustContainer,
  AuthenticatedUser,
  Container,
  ContainerTxn,
  ContainerTxnType,
  ContainerType,
  CreateContainer,
  ScrapContainer,
  ScrapReason,
  UpdateContainer,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { extendedValue } from "../inventory/valuation";
import {
  applyInbound,
  applyOutbound,
  InsufficientStockError,
  type PostingResult,
} from "../stock/stock-costing";

type ContainerRow = Prisma.ContainerGetPayload<{ include: { stock: true } }>;

/** A single OUT movement for packing an order. */
export interface ContainerConsumeEntry {
  containerId: string;
  quantity: string;
}

@Injectable()
export class ContainerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Container[]> {
    const rows = await this.prisma.container.findMany({
      where: { tenantId },
      include: { stock: true },
      orderBy: { sku: "asc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async getById(tenantId: string, id: string): Promise<Container> {
    const row = await this.prisma.container.findFirst({
      where: { id, tenantId },
      include: { stock: true },
    });
    if (!row) throw new NotFoundException("Container not found");
    return this.toDto(row);
  }

  async create(user: AuthenticatedUser, input: CreateContainer): Promise<Container> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.container.create({
          data: {
            tenantId: user.tenantId,
            sku: input.sku,
            name: input.name,
            containerType: input.containerType,
            capacityLb: input.capacityLb ?? null,
            standardCost: input.standardCost,
            reorderPoint: input.reorderPoint ?? null,
            active: input.active,
            stock: { create: { tenantId: user.tenantId, quantity: "0", avgCost: "0" } },
          },
          include: { stock: true },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Container",
          entityId: row.id,
          action: "CREATE",
          after: this.toDto(row),
        });
        // Optional opening balance: post an IN adjustment in the same transaction
        // (unit cost defaults to the standard cost) — no dummy PO needed.
        if (input.openingQuantity) {
          await this.postTxn(tx, user, row.id, {
            type: "ADJUSTMENT",
            direction: "IN",
            quantity: input.openingQuantity,
            unitCost: input.openingUnitCost ?? input.standardCost,
            note: "Opening balance",
          });
        }
        return row;
      });
      // Re-read so the opening balance (if any) is reflected in the position.
      return this.getById(user.tenantId, created.id);
    } catch (err) {
      throw this.mapWriteError(err, input.sku);
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateContainer,
  ): Promise<Container> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.container.findFirst({
          where: { id, tenantId: user.tenantId },
          include: { stock: true },
        });
        if (!existing) throw new NotFoundException("Container not found");
        const row = await tx.container.update({
          where: { id: existing.id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.containerType === undefined
              ? {}
              : { containerType: input.containerType }),
            ...(input.capacityLb === undefined
              ? {}
              : { capacityLb: input.capacityLb ?? null }),
            ...(input.standardCost === undefined
              ? {}
              : { standardCost: input.standardCost }),
            ...(input.reorderPoint === undefined
              ? {}
              : { reorderPoint: input.reorderPoint ?? null }),
            ...(input.active === undefined ? {} : { active: input.active }),
          },
          include: { stock: true },
        });
        await this.audit.record(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          entityType: "Container",
          entityId: row.id,
          action: "UPDATE",
          before: this.toDto(existing),
          after: this.toDto(row),
        });
        return row;
      });
      return this.toDto(updated);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  /** Receive (IN, re-averages cost) or correct (OUT) container stock. */
  async adjust(
    user: AuthenticatedUser,
    id: string,
    input: AdjustContainer,
  ): Promise<Container> {
    if (input.direction === "IN" && input.unitCost === undefined) {
      throw new BadRequestException("A unit cost is required to receive containers");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.postTxn(tx, user, id, {
        type: "ADJUSTMENT",
        direction: input.direction,
        quantity: input.quantity,
        unitCost: input.unitCost,
        note: input.note ?? null,
      });
    });
    return this.getById(user.tenantId, id);
  }

  /** Write off damaged containers (OUT at average cost, recorded as SCRAP). */
  async scrap(
    user: AuthenticatedUser,
    id: string,
    input: ScrapContainer,
  ): Promise<Container> {
    await this.prisma.$transaction(async (tx) => {
      await this.postTxn(tx, user, id, {
        type: "SCRAP",
        direction: "OUT",
        quantity: input.quantity,
        reason: input.reason,
        note: input.note ?? null,
      });
    });
    return this.getById(user.tenantId, id);
  }

  async transactions(tenantId: string, id: string): Promise<ContainerTxn[]> {
    await this.getById(tenantId, id); // tenant-scoped existence check
    const rows = await this.prisma.containerTxn.findMany({
      where: { tenantId, containerId: id },
      orderBy: { occurredAt: "desc" },
    });
    return rows.map((t) => ({
      id: t.id,
      containerId: t.containerId,
      type: t.type as ContainerTxnType,
      quantity: t.quantity.toString(),
      unitCost: t.unitCost.toString(),
      value: t.value.toString(),
      balanceQty: t.balanceQty.toString(),
      reason: (t.reason as ScrapReason | null) ?? null,
      note: t.note,
      docType: t.docType,
      docId: t.docId,
      occurredAt: t.occurredAt.toISOString(),
    }));
  }

  /**
   * Consume containers (OUT, type CONSUME) within an existing transaction —
   * used when packing a sales order. Throws BadRequest if stock is short.
   */
  async consumeInTx(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    entries: ContainerConsumeEntry[],
    doc: { docType: string; docId: string; note?: string },
  ): Promise<void> {
    for (const entry of entries) {
      await this.postTxn(tx, user, entry.containerId, {
        type: "CONSUME",
        direction: "OUT",
        quantity: entry.quantity,
        docType: doc.docType,
        docId: doc.docId,
        note: doc.note ?? null,
      });
    }
  }

  /**
   * Receive containers (IN, re-averaging cost) within an existing transaction —
   * used when receiving a purchase order. Recorded as an ADJUSTMENT tied to the
   * PO via docType/docId (no QC/quarantine — containers are supplies).
   */
  async receiveInTx(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    entries: { containerId: string; quantity: string; unitCost: string }[],
    doc: { docType: string; docId: string; note?: string },
  ): Promise<void> {
    for (const entry of entries) {
      await this.postTxn(tx, user, entry.containerId, {
        type: "ADJUSTMENT",
        direction: "IN",
        quantity: entry.quantity,
        unitCost: entry.unitCost,
        docType: doc.docType,
        docId: doc.docId,
        note: doc.note ?? null,
      });
    }
  }

  /**
   * Sell containers (OUT, type SALE) within an existing transaction — used when
   * shipping a sales order line that sells the container itself. Returns the
   * posted cost per container so the shipment line can record COGS.
   */
  async sellInTx(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    entries: ContainerConsumeEntry[],
    doc: { docType: string; docId: string; note?: string },
  ): Promise<{ containerId: string; quantity: string; unitCost: string; value: string }[]> {
    const posted: {
      containerId: string;
      quantity: string;
      unitCost: string;
      value: string;
    }[] = [];
    for (const entry of entries) {
      const result = await this.postTxn(tx, user, entry.containerId, {
        type: "SALE",
        direction: "OUT",
        quantity: entry.quantity,
        docType: doc.docType,
        docId: doc.docId,
        note: doc.note ?? null,
      });
      posted.push({
        containerId: entry.containerId,
        quantity: entry.quantity,
        // OUT movements are signed negative — report COGS as positive.
        unitCost: result.unitCost,
        value: new Decimal(result.value).abs().toString(),
      });
    }
    return posted;
  }

  /** Post one container movement: write the ledger row + update the position. */
  private async postTxn(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    containerId: string,
    move: {
      type: ContainerTxnType;
      direction: "IN" | "OUT";
      quantity: string;
      unitCost?: string;
      reason?: ScrapReason;
      note?: string | null;
      docType?: string;
      docId?: string;
    },
  ): Promise<PostingResult> {
    const container = await tx.container.findFirst({
      where: { id: containerId, tenantId: user.tenantId },
      include: { stock: true },
    });
    if (!container) throw new NotFoundException("Container not found");

    const position = {
      quantity: (container.stock?.quantity ?? new Decimal(0)).toString(),
      avgCost: (container.stock?.avgCost ?? new Decimal(0)).toString(),
    };

    let result;
    if (move.direction === "IN") {
      result = applyInbound(position, move.quantity, move.unitCost ?? "0");
    } else {
      try {
        result = applyOutbound(position, move.quantity);
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          throw new BadRequestException(
            `Insufficient stock for ${container.sku}: have ${err.available}, need ${err.requested}`,
          );
        }
        throw err;
      }
    }

    await tx.containerTxn.create({
      data: {
        tenantId: user.tenantId,
        containerId,
        type: move.type,
        quantity: result.quantity,
        unitCost: result.unitCost,
        value: result.value,
        balanceQty: result.balanceQty,
        balanceAvgCost: result.balanceAvgCost,
        reason: move.reason ?? null,
        note: move.note ?? null,
        docType: move.docType ?? null,
        docId: move.docId ?? null,
        operatorId: user.id,
      },
    });
    await tx.containerStock.upsert({
      where: { containerId },
      create: {
        tenantId: user.tenantId,
        containerId,
        quantity: result.balanceQty,
        avgCost: result.balanceAvgCost,
      },
      update: { quantity: result.balanceQty, avgCost: result.balanceAvgCost },
    });
    await this.audit.record(tx, {
      tenantId: user.tenantId,
      actorId: user.id,
      entityType: "Container",
      entityId: containerId,
      action: "UPDATE",
      after: {
        txn: move.type,
        quantity: result.quantity,
        balanceQty: result.balanceQty,
        ...(move.reason ? { reason: move.reason } : {}),
        ...(move.docId ? { docId: move.docId } : {}),
      },
    });
    return result;
  }

  private toDto(row: ContainerRow): Container {
    const quantity = (row.stock?.quantity ?? new Decimal(0)).toString();
    const avgCost = (row.stock?.avgCost ?? new Decimal(0)).toString();
    return {
      id: row.id,
      tenantId: row.tenantId,
      sku: row.sku,
      name: row.name,
      containerType: row.containerType as ContainerType,
      capacityLb: row.capacityLb === null ? null : row.capacityLb.toString(),
      standardCost: row.standardCost.toString(),
      reorderPoint: row.reorderPoint === null ? null : row.reorderPoint.toString(),
      active: row.active,
      quantityOnHand: quantity,
      avgCost,
      totalValue: extendedValue(quantity, avgCost),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapWriteError(err: unknown, sku?: string): Error {
    if (err instanceof NotFoundException || err instanceof BadRequestException) {
      return err;
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return new ConflictException(
        sku ? `Container SKU "${sku}" already exists` : "Duplicate value",
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

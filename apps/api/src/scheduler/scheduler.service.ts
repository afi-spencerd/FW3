import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AuthenticatedUser,
  CustomerRating,
  ProductionStatus,
  SchedulerBoard,
  SchedulerWorkOrder,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { BusinessVariablesService } from "../business-variables/business-variables.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { StockService } from "../stock/stock.service";

type BoardWorkOrder = Prisma.ProductionWorkOrderGetPayload<{
  include: {
    target: true;
    formula: true;
    lines: { include: { component: true } };
    salesOrder: { include: { customer: true } };
    salesOrderLine: { include: { container: true } };
  };
}>;

/** Ship dates inside this window are flagged RUSH (72 hours, in ms). */
const RUSH_WINDOW_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class SchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
    private readonly businessVars: BusinessVariablesService,
  ) {}

  /** The Requested | Queued board, with feasibility + RUSH + suggested slots. */
  async board(tenantId: string): Promise<SchedulerBoard> {
    const orders = await this.loadBoardOrders(tenantId, ["REQUESTED", "QUEUED"]);

    // INV availability per item (canonical pounds) and container counts on hand.
    const positions = await this.stock.getStockPositions(tenantId);
    const invByItem = new Map(
      positions
        .filter((p) => p.status === "INV")
        .map((p) => [p.itemId, p.quantity]),
    );
    const containerIds = [
      ...new Set(
        orders.map((o) => o.salesOrderLine?.containerId).filter(Boolean) as string[],
      ),
    ];
    const containerStock = containerIds.length
      ? await this.prisma.containerStock.findMany({
          where: { tenantId, containerId: { in: containerIds } },
        })
      : [];
    const containerQtyById = new Map(
      containerStock.map((s) => [s.containerId, s.quantity.toString()]),
    );

    const dailyCapacity = await this.dailyPourCapacity(tenantId);
    const now = Date.now();

    const dto = (wo: BoardWorkOrder): SchedulerWorkOrder =>
      this.toDto(wo, invByItem, containerQtyById, dailyCapacity, now);

    const requested = orders
      .filter((o) => o.status === "REQUESTED")
      .map(dto)
      .sort((a, b) => this.compareByRules(a, b));
    const queued = orders
      .filter((o) => o.status === "QUEUED")
      .map(dto)
      .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));

    // A requested order's suggested slot = where it would merge into the current
    // queue by the run-order rules (shown, not applied).
    for (const r of requested) {
      r.suggestedPosition = queued.filter(
        (q) => this.compareByRules(q, r) <= 0,
      ).length;
    }

    return { requested, queued };
  }

  /** Move a requested order into the queue at `position` (default = suggested). */
  async enqueue(
    user: AuthenticatedUser,
    id: string,
    position?: number,
  ): Promise<SchedulerBoard> {
    await this.prisma.$transaction(async (tx) => {
      const wo = await this.requireStatus(tx, user.tenantId, id, "REQUESTED");
      const queued = await this.loadQueueIds(tx, user.tenantId);
      const target =
        position === undefined
          ? await this.suggestedSlot(tx, user.tenantId, wo)
          : Math.min(Math.max(position, 0), queued.length);
      const order = [...queued.slice(0, target), id, ...queued.slice(target)];
      await tx.productionWorkOrder.update({
        where: { id },
        data: { status: "QUEUED" },
      });
      await this.applyPositions(tx, order);
      await this.auditQueue(tx, user, id, { enqueuedAt: target });
    });
    return this.board(user.tenantId);
  }

  /** Move a selected subset of requested orders into the queue, in rule order. */
  async queueByRules(
    user: AuthenticatedUser,
    ids: string[],
  ): Promise<SchedulerBoard> {
    await this.prisma.$transaction(async (tx) => {
      const selected = await this.loadBoardOrders(user.tenantId, ["REQUESTED"], tx);
      const chosen = selected.filter((o) => ids.includes(o.id));
      if (chosen.length === 0) {
        throw new BadRequestException("No requested work orders match the selection");
      }
      const now = Date.now();
      const sorted = chosen
        .map((o) => ({ id: o.id, key: this.ruleKeyForOrder(o, now) }))
        .sort((a, b) => this.compareKeys(a.key, b.key))
        .map((x) => x.id);
      const queued = await this.loadQueueIds(tx, user.tenantId);
      await tx.productionWorkOrder.updateMany({
        where: { id: { in: sorted }, tenantId: user.tenantId },
        data: { status: "QUEUED" },
      });
      await this.applyPositions(tx, [...queued, ...sorted]);
      await this.auditQueue(tx, user, null, { queuedByRules: sorted });
    });
    return this.board(user.tenantId);
  }

  /** Reorder a queued work order to an explicit position. */
  async reposition(
    user: AuthenticatedUser,
    id: string,
    position: number,
  ): Promise<SchedulerBoard> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireStatus(tx, user.tenantId, id, "QUEUED");
      const queued = (await this.loadQueueIds(tx, user.tenantId)).filter(
        (q) => q !== id,
      );
      const target = Math.min(Math.max(position, 0), queued.length);
      const order = [...queued.slice(0, target), id, ...queued.slice(target)];
      await this.applyPositions(tx, order);
      await this.auditQueue(tx, user, id, { repositionedTo: target });
    });
    return this.board(user.tenantId);
  }

  /**
   * Release a queued order to the floor: it becomes PLANNED (ready to stage) with
   * no material movement — staging stays the floor's deliberate action. The
   * remaining queue is renumbered to close the gap.
   */
  async release(user: AuthenticatedUser, id: string): Promise<SchedulerBoard> {
    await this.prisma.$transaction(async (tx) => {
      await this.requireStatus(tx, user.tenantId, id, "QUEUED");
      await tx.productionWorkOrder.update({
        where: { id },
        data: { status: "PLANNED", queuePosition: null },
      });
      const remaining = await this.loadQueueIds(tx, user.tenantId);
      await this.applyPositions(tx, remaining);
      await this.auditQueue(tx, user, id, { released: true });
    });
    return this.board(user.tenantId);
  }

  // ---- helpers ----

  private async loadBoardOrders(
    tenantId: string,
    statuses: ProductionStatus[],
    tx?: Prisma.TransactionClient,
  ): Promise<BoardWorkOrder[]> {
    const db = tx ?? this.prisma;
    return db.productionWorkOrder.findMany({
      where: { tenantId, status: { in: statuses } },
      include: {
        target: true,
        formula: true,
        lines: { include: { component: true } },
        salesOrder: { include: { customer: true } },
        salesOrderLine: { include: { container: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  private async dailyPourCapacity(tenantId: string): Promise<number> {
    const pph = await this.businessVars.getValue(tenantId, "poursPerHour", "FLOOR");
    const hours = await this.businessVars.getValue(tenantId, "workingHoursPerDay");
    return Math.floor(Number(pph ?? 0) * Number(hours ?? 0));
  }

  private toDto(
    wo: BoardWorkOrder,
    invByItem: Map<string, string>,
    containerQtyById: Map<string, string>,
    dailyCapacity: number,
    now: number,
  ): SchedulerWorkOrder {
    const materials = wo.lines.map((line) => {
      const required = line.requiredQty.toString();
      const available = invByItem.get(line.componentId) ?? "0";
      return {
        componentId: line.componentId,
        sku: line.component.sku,
        name: line.component.name,
        requiredQty: required,
        availableQty: available,
        short: new Decimal(available).lessThan(required),
      };
    });

    let container: SchedulerWorkOrder["feasibility"]["container"] = null;
    const soLine = wo.salesOrderLine;
    if (soLine?.containerId && soLine.containerQuantity) {
      const required = soLine.containerQuantity.toString();
      const available = containerQtyById.get(soLine.containerId) ?? "0";
      container = {
        containerId: soLine.containerId,
        sku: soLine.container?.sku ?? "",
        name: soLine.container?.name ?? "",
        requiredQty: required,
        availableQty: available,
        short: new Decimal(available).lessThan(required),
      };
    }

    const poursNeeded = wo.lines.length;
    const blocked = materials.some((m) => m.short) || (container?.short ?? false);
    const requestedShipDate = wo.salesOrder?.requestedShipDate ?? null;
    const isRush =
      requestedShipDate !== null &&
      requestedShipDate.getTime() - now < RUSH_WINDOW_MS;

    return {
      id: wo.id,
      workOrderNumber: wo.workOrderNumber,
      status: wo.status as ProductionStatus,
      targetItemId: wo.targetItemId,
      targetSku: wo.target.sku,
      targetName: wo.target.name,
      formulaName: wo.formula.name,
      batchSize: wo.batchSize.toString(),
      outputQty: wo.outputQty.toString(),
      lineCount: wo.lines.length,
      salesOrderId: wo.salesOrderId,
      soNumber: wo.salesOrder?.soNumber ?? null,
      customerName: wo.salesOrder?.customer.name ?? null,
      customerRating: (wo.salesOrder?.customer.rating ?? null) as CustomerRating | null,
      requestedShipDate: requestedShipDate?.toISOString() ?? null,
      isRush,
      queuePosition: wo.queuePosition,
      suggestedPosition: null,
      feasibility: {
        blocked,
        materials,
        container,
        manpower: {
          poursNeeded,
          dailyCapacity,
          withinCapacity: dailyCapacity <= 0 ? false : poursNeeded <= dailyCapacity,
        },
      },
    };
  }

  /**
   * Run-order rules: RUSH first, then customer rating A→D (null last), then
   * earliest requested ship date, then oldest created. Returns -1/0/1.
   */
  private compareByRules(a: SchedulerWorkOrder, b: SchedulerWorkOrder): number {
    return this.compareKeys(this.ruleKey(a), this.ruleKey(b));
  }

  private ruleKey(wo: SchedulerWorkOrder): [number, number, number] {
    const ratingRank = wo.customerRating
      ? "ABCD".indexOf(wo.customerRating)
      : 4;
    const shipMs = wo.requestedShipDate
      ? new Date(wo.requestedShipDate).getTime()
      : Number.POSITIVE_INFINITY;
    return [wo.isRush ? 0 : 1, ratingRank, shipMs];
  }

  private ruleKeyForOrder(
    wo: BoardWorkOrder,
    now: number,
  ): [number, number, number] {
    const ship = wo.salesOrder?.requestedShipDate ?? null;
    const isRush = ship !== null && ship.getTime() - now < RUSH_WINDOW_MS;
    const rating = wo.salesOrder?.customer.rating ?? null;
    const ratingRank = rating ? "ABCD".indexOf(rating) : 4;
    const shipMs = ship ? ship.getTime() : Number.POSITIVE_INFINITY;
    return [isRush ? 0 : 1, ratingRank, shipMs];
  }

  private compareKeys(
    a: [number, number, number],
    b: [number, number, number],
  ): number {
    for (let i = 0; i < a.length; i++) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  }

  private async loadQueueIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string[]> {
    const rows = await tx.productionWorkOrder.findMany({
      where: { tenantId, status: "QUEUED" },
      orderBy: { queuePosition: "asc" },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async applyPositions(
    tx: Prisma.TransactionClient,
    orderedIds: string[],
  ): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.productionWorkOrder.update({
        where: { id: orderedIds[i]! },
        data: { queuePosition: i },
      });
    }
  }

  private async suggestedSlot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    wo: BoardWorkOrder,
  ): Promise<number> {
    const now = Date.now();
    const key = this.ruleKeyForOrder(wo, now);
    const queued = await this.loadBoardOrders(tenantId, ["QUEUED"], tx);
    return queued.filter(
      (q) => this.compareKeys(this.ruleKeyForOrder(q, now), key) <= 0,
    ).length;
  }

  private async requireStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    status: ProductionStatus,
  ): Promise<BoardWorkOrder> {
    const [wo] = await this.loadBoardOrders(tenantId, [status], tx).then((rows) =>
      rows.filter((r) => r.id === id),
    );
    if (!wo) {
      // Distinguish "wrong status" from "not found" for a clearer message.
      const exists = await tx.productionWorkOrder.findFirst({
        where: { id, tenantId },
        select: { status: true },
      });
      if (!exists) throw new NotFoundException("Work order not found");
      throw new BadRequestException(
        `Work order is ${exists.status}, not ${status}`,
      );
    }
    return wo;
  }

  private async auditQueue(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    id: string | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      tenantId: user.tenantId,
      actorId: user.id,
      entityType: "ProductionWorkOrder",
      entityId: id ?? "scheduler",
      action: "UPDATE",
      after,
    });
  }
}

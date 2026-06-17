import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import Decimal from "decimal.js";
import {
  type AdjustStock,
  type AuthenticatedUser,
  type DocType,
  type InventoryPosition,
  type InventoryTxn as InventoryTxnDto,
  type ItemLocationPosition,
  type ItemType,
  isStockableKind,
  type LocatedStockStatus,
  type LocationKind,
  type LocationMove,
  type MoveStock,
  type StockPosition,
  type StockStatus,
  type TxnType,
  type UnitOfMeasure,
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
} from "./stock-costing";

/** One movement to post. Magnitudes positive; direction signs it. status defaults INV. */
export interface Movement {
  itemId: string;
  type: TxnType;
  direction: "IN" | "OUT";
  quantity: string;
  /** Required for inbound; outbound costs out at the current average for that status. */
  unitCost?: string;
  /** Which bucket the movement lands in. Defaults to INV (LOT-traceable). */
  status?: StockStatus;
  /**
   * For located statuses (INV/QUARANTINE): which location to place into
   * (inbound) or prefer when drawing down (outbound). Defaults are resolved
   * per status (receiving for QUARANTINE inbound, default storage otherwise).
   */
  locationId?: string;
}

/** INV and QUARANTINE quantity is tracked by physical location; WIP is not. */
function isLocated(status: StockStatus): status is LocatedStockStatus {
  return status === "INV" || status === "QUARANTINE";
}

export interface PostingDoc {
  docType?: DocType;
  docId?: string;
  note?: string;
}

export interface PostedLine extends PostingResult {
  itemId: string;
  type: TxnType;
  status: StockStatus;
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Post movements to the ledger within an existing transaction. Each one
   * re-averages (inbound) or costs out at the average (outbound) for its
   * (item, status) bucket, writes the InventoryTxn with a running-balance
   * snapshot, and updates ItemStock. The INV bucket is mirrored onto
   * InventoryItem so existing reads (valuation, lists) keep working.
   */
  async post(
    tx: Prisma.TransactionClient,
    tenantId: string,
    movements: Movement[],
    doc: PostingDoc,
  ): Promise<PostedLine[]> {
    const posted: PostedLine[] = [];
    for (const movement of movements) {
      const status: StockStatus = movement.status ?? "INV";
      const item = await tx.inventoryItem.findFirst({
        where: { id: movement.itemId, tenantId },
      });
      if (!item) {
        throw new BadRequestException(`Item ${movement.itemId} not found`);
      }
      const stock = await tx.itemStock.findUnique({
        where: { itemId_status: { itemId: movement.itemId, status } },
      });
      // Fall back to the item's mirrored opening balance for INV when no
      // ItemStock row exists yet (e.g. an item created with an opening qty).
      const position = stock
        ? { quantity: stock.quantity.toString(), avgCost: stock.avgCost.toString() }
        : status === "INV"
          ? {
              quantity: item.quantityOnHand.toString(),
              avgCost: item.unitCost.toString(),
            }
          : { quantity: "0", avgCost: "0" };

      let result: PostingResult;
      if (movement.direction === "IN") {
        if (movement.unitCost === undefined) {
          throw new BadRequestException(
            `Inbound movement for ${item.sku} requires a unit cost`,
          );
        }
        result = applyInbound(position, movement.quantity, movement.unitCost);
      } else {
        try {
          result = applyOutbound(position, movement.quantity);
        } catch (err) {
          if (err instanceof InsufficientStockError) {
            throw new BadRequestException(
              `Insufficient ${status} stock for ${item.sku}: have ${err.available}, need ${err.requested}`,
            );
          }
          throw err;
        }
      }

      await tx.inventoryTxn.create({
        data: {
          tenantId,
          itemId: movement.itemId,
          type: movement.type,
          status,
          quantity: result.quantity,
          unitCost: result.unitCost,
          value: result.value,
          balanceQty: result.balanceQty,
          balanceAvgCost: result.balanceAvgCost,
          docType: doc.docType ?? null,
          docId: doc.docId ?? null,
          note: doc.note ?? null,
        },
      });
      await tx.itemStock.upsert({
        where: { itemId_status: { itemId: movement.itemId, status } },
        create: {
          tenantId,
          itemId: movement.itemId,
          status,
          quantity: result.balanceQty,
          avgCost: result.balanceAvgCost,
        },
        update: { quantity: result.balanceQty, avgCost: result.balanceAvgCost },
      });
      if (status === "INV") {
        await tx.inventoryItem.update({
          where: { id: movement.itemId },
          data: {
            quantityOnHand: result.balanceQty,
            unitCost: result.balanceAvgCost,
          },
        });
      }

      // Maintain the per-location quantity breakdown for located statuses, so
      // the sum over locations stays equal to the ItemStock quantity. Cost is
      // item-level and untouched here.
      if (isLocated(status)) {
        if (movement.direction === "IN") {
          const locationId =
            movement.locationId ??
            (await this.resolveInboundLocationId(tx, tenantId, status));
          if (locationId) {
            await this.placeAtLocation(
              tx,
              tenantId,
              movement.itemId,
              status,
              locationId,
              movement.quantity,
            );
          }
        } else {
          await this.removeFromLocations(
            tx,
            tenantId,
            movement.itemId,
            status,
            movement.quantity,
            movement.locationId,
          );
        }
      }

      posted.push({ itemId: movement.itemId, type: movement.type, status, ...result });
    }
    return posted;
  }

  /**
   * Move stock between statuses (e.g. INV -> WIP, or pack-off WIP -> INV). Cost
   * flows with the goods: out at the source average, in at that same cost, so
   * the two ledger lines are value-balanced.
   */
  async transfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
    fromStatus: StockStatus,
    toStatus: StockStatus,
    quantity: string,
    doc: PostingDoc,
    type: TxnType = "TRANSFER",
    locations?: { fromLocationId?: string; toLocationId?: string },
  ): Promise<void> {
    const [out] = await this.post(
      tx,
      tenantId,
      [
        {
          itemId,
          type,
          direction: "OUT",
          quantity,
          status: fromStatus,
          ...(locations?.fromLocationId
            ? { locationId: locations.fromLocationId }
            : {}),
        },
      ],
      doc,
    );
    if (!out) return;
    await this.post(
      tx,
      tenantId,
      [
        {
          itemId,
          type,
          direction: "IN",
          quantity,
          unitCost: out.unitCost,
          status: toStatus,
          ...(locations?.toLocationId
            ? { locationId: locations.toLocationId }
            : {}),
        },
      ],
      doc,
    );
  }

  /** Manual adjustment (opening balances, counts, corrections) — INV bucket. */
  async adjust(
    user: AuthenticatedUser,
    itemId: string,
    input: AdjustStock,
  ): Promise<InventoryPosition> {
    await this.prisma.$transaction(async (tx) => {
      const movement: Movement = {
        itemId,
        type: "ADJUSTMENT",
        direction: input.direction,
        quantity: input.quantity,
        ...(input.unitCost === undefined ? {} : { unitCost: input.unitCost }),
      };
      const [line] = await this.post(tx, user.tenantId, [movement], {
        docType: "ADJUSTMENT",
        note: input.note ?? undefined,
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "InventoryItem",
        entityId: itemId,
        action: "UPDATE",
        after: { adjustment: input, balance: line?.balanceQty },
      });
    });
    return this.getPosition(user.tenantId, itemId);
  }

  /**
   * Pack-off: move a quantity of an item from FG_WIP to FG_INV (usable). Only
   * QC-APPROVED production-lot quantity may be packed off — FG can't leave WIP
   * until its lot passes QC. Allocates against approved lots FIFO.
   */
  async packOff(
    user: AuthenticatedUser,
    itemId: string,
    quantity: string,
  ): Promise<InventoryPosition> {
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, tenantId: user.tenantId },
      });
      if (!item) throw new NotFoundException("Inventory item not found");

      const requested = new Decimal(quantity);
      const lots = await tx.receivedLot.findMany({
        where: {
          tenantId: user.tenantId,
          itemId,
          origin: "PRODUCTION",
          qcStatus: "APPROVED",
        },
        orderBy: { receivedAt: "asc" },
      });
      const available = lots.reduce(
        (sum, lot) => sum.plus(lot.quantity.minus(lot.packedQty)),
        new Decimal(0),
      );
      if (requested.greaterThan(available)) {
        throw new BadRequestException(
          `Cannot pack off ${requested} of ${item.sku}: only ${available} is QC-approved in WIP`,
        );
      }

      // Consume approved lots FIFO.
      let remaining = requested;
      for (const lot of lots) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const lotRemaining = lot.quantity.minus(lot.packedQty);
        if (lotRemaining.lessThanOrEqualTo(0)) continue;
        const take = Decimal.min(remaining, lotRemaining);
        await tx.receivedLot.update({
          where: { id: lot.id },
          data: { packedQty: lot.packedQty.plus(take) },
        });
        remaining = remaining.minus(take);
      }

      await this.transfer(tx, user.tenantId, itemId, "WIP", "INV", quantity, {
        docType: "PRODUCTION_RUN",
        note: `Pack-off ${item.sku}`,
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "InventoryItem",
        entityId: itemId,
        action: "UPDATE",
        after: { packOff: quantity },
      });
    });
    return this.getPosition(user.tenantId, itemId);
  }

  /** Current LOT-traceable (INV) position of an item. */
  async getPosition(tenantId: string, itemId: string): Promise<InventoryPosition> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException("Inventory item not found");
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      unitOfMeasure: item.unitOfMeasure as UnitOfMeasure,
      quantityOnHand: item.quantityOnHand.toString(),
      avgCost: item.unitCost.toString(),
      totalValue: extendedValue(
        item.quantityOnHand.toString(),
        item.unitCost.toString(),
      ),
    };
  }

  async getLedger(tenantId: string, itemId: string): Promise<InventoryTxnDto[]> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("Inventory item not found");

    const txns = await this.prisma.inventoryTxn.findMany({
      where: { tenantId, itemId },
      orderBy: { occurredAt: "asc" },
    });
    return txns.map((t) => ({
      id: t.id,
      itemId: t.itemId,
      type: t.type as TxnType,
      status: t.status as StockStatus,
      quantity: t.quantity.toString(),
      unitCost: t.unitCost.toString(),
      value: t.value.toString(),
      balanceQty: t.balanceQty.toString(),
      balanceAvgCost: t.balanceAvgCost.toString(),
      docType: (t.docType as DocType | null) ?? null,
      docId: t.docId,
      note: t.note,
      occurredAt: t.occurredAt.toISOString(),
    }));
  }

  /** All per-(item, status) positions — drives the WIP vs LOT-traceable report. */
  async getStockPositions(tenantId: string): Promise<StockPosition[]> {
    const rows = await this.prisma.itemStock.findMany({
      where: { tenantId },
      include: { item: true },
      orderBy: [{ status: "asc" }],
    });
    return rows
      .map((r) => ({
        itemId: r.itemId,
        sku: r.item.sku,
        name: r.item.name,
        itemType: r.item.itemType as ItemType,
        status: r.status as StockStatus,
        quantity: r.quantity.toString(),
        avgCost: r.avgCost.toString(),
        totalValue: extendedValue(r.quantity.toString(), r.avgCost.toString()),
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku) || a.status.localeCompare(b.status));
  }

  // ---- Physical locations ----

  /**
   * Move a quantity of an item between two locations within one stock status.
   * Pure quantity reallocation: ItemStock (qty+cost) and the cost ledger are
   * untouched; only the per-location breakdown changes, plus a LocationMove row.
   */
  async moveLocation(
    user: AuthenticatedUser,
    itemId: string,
    input: MoveStock,
  ): Promise<ItemLocationPosition[]> {
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, tenantId: user.tenantId },
      });
      if (!item) throw new NotFoundException("Inventory item not found");

      const [from, to] = await Promise.all([
        tx.location.findFirst({
          where: { id: input.fromLocationId, tenantId: user.tenantId },
        }),
        tx.location.findFirst({
          where: { id: input.toLocationId, tenantId: user.tenantId },
        }),
      ]);
      if (!from) throw new BadRequestException("Source location not found");
      if (!to) throw new BadRequestException("Destination location not found");
      if (!to.active) {
        throw new BadRequestException(`Destination ${to.name} is inactive`);
      }
      // Stock only sits at leaves (racks/areas), not buildings or aisles.
      for (const loc of [from, to]) {
        if (!isStockableKind(loc.kind as LocationKind)) {
          throw new BadRequestException(
            `${loc.name} is a ${loc.kind.toLowerCase()}; stock can only sit in racks or areas`,
          );
        }
      }

      const requested = new Decimal(input.quantity);
      const src = await tx.itemStockLocation.findUnique({
        where: {
          itemId_status_locationId: {
            itemId,
            status: input.status,
            locationId: input.fromLocationId,
          },
        },
      });
      const available = src?.quantity ?? new Decimal(0);
      if (requested.greaterThan(available)) {
        throw new BadRequestException(
          `Cannot move ${requested} of ${item.sku} from ${from.name}: only ${available} ${input.status} there`,
        );
      }

      await this.removeFromLocations(
        tx,
        user.tenantId,
        itemId,
        input.status,
        input.quantity,
        input.fromLocationId,
      );
      await this.placeAtLocation(
        tx,
        user.tenantId,
        itemId,
        input.status,
        input.toLocationId,
        input.quantity,
      );
      await tx.locationMove.create({
        data: {
          tenantId: user.tenantId,
          itemId,
          status: input.status,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          quantity: input.quantity,
          note: input.note ?? null,
          actorId: user.id,
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "InventoryItem",
        entityId: itemId,
        action: "UPDATE",
        after: { locationMove: input },
      });
    });
    return this.getItemLocations(user.tenantId, itemId);
  }

  /** Per-(status, location) quantity breakdown for an item. */
  async getItemLocations(
    tenantId: string,
    itemId: string,
  ): Promise<ItemLocationPosition[]> {
    const rows = await this.prisma.itemStockLocation.findMany({
      where: { tenantId, itemId },
      include: { location: true },
    });
    return rows
      .filter((r) => !r.quantity.isZero())
      .map((r) => ({
        itemId,
        status: r.status as LocatedStockStatus,
        locationId: r.locationId,
        locationName: r.location.name,
        locationCode: r.location.code,
        quantity: r.quantity.toString(),
      }))
      .sort(
        (a, b) =>
          a.status.localeCompare(b.status) ||
          a.locationName.localeCompare(b.locationName),
      );
  }

  /** Physical move history for an item (newest first). */
  async getLocationMoves(
    tenantId: string,
    itemId: string,
  ): Promise<LocationMove[]> {
    const rows = await this.prisma.locationMove.findMany({
      where: { tenantId, itemId },
      include: { fromLocation: true, toLocation: true },
      orderBy: { occurredAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      status: r.status as LocatedStockStatus,
      fromLocationId: r.fromLocationId,
      fromLocationName: r.fromLocation?.name ?? null,
      toLocationId: r.toLocationId,
      toLocationName: r.toLocation?.name ?? null,
      quantity: r.quantity.toString(),
      note: r.note,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }

  /**
   * Where inbound stock of a status lands by default — the receiving area (for
   * QUARANTINE) or default storage (otherwise), scoped to a building when known,
   * else the first one in the tenant. Falls back to any active leaf.
   */
  private async resolveInboundLocationId(
    tx: Prisma.TransactionClient,
    tenantId: string,
    status: LocatedStockStatus,
    buildingId?: string,
  ): Promise<string | null> {
    const flag = status === "QUARANTINE" ? "isReceiving" : "isDefault";
    if (buildingId) {
      const inBuilding = await tx.location.findFirst({
        where: { tenantId, buildingId, [flag]: true, active: true },
      });
      if (inBuilding) return inBuilding.id;
    }
    const flagged = await tx.location.findFirst({
      where: { tenantId, [flag]: true, active: true },
      orderBy: { code: "asc" },
    });
    if (flagged) return flagged.id;
    const anyLeaf = await tx.location.findFirst({
      where: { tenantId, active: true, kind: { in: ["RACK", "AREA"] } },
      orderBy: { code: "asc" },
    });
    return anyLeaf?.id ?? null;
  }

  /** Add quantity to one (item, status, location) cell. */
  private async placeAtLocation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
    status: LocatedStockStatus,
    locationId: string,
    quantity: string,
  ): Promise<void> {
    const qty = new Decimal(quantity);
    const existing = await tx.itemStockLocation.findUnique({
      where: { itemId_status_locationId: { itemId, status, locationId } },
    });
    if (existing) {
      await tx.itemStockLocation.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity.plus(qty).toString() },
      });
    } else {
      await tx.itemStockLocation.create({
        data: { tenantId, itemId, status, locationId, quantity: qty.toString() },
      });
    }
  }

  /**
   * Draw a quantity down across an item's locations for a status, preferring a
   * given location, then the default, then by name. Tolerant: if location rows
   * don't cover the amount (legacy data with no breakdown), it removes what's
   * there and stops rather than going negative.
   */
  private async removeFromLocations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
    status: LocatedStockStatus,
    quantity: string,
    preferredLocationId?: string,
  ): Promise<void> {
    let remaining = new Decimal(quantity);
    if (remaining.lessThanOrEqualTo(0)) return;
    const rows = await tx.itemStockLocation.findMany({
      where: { tenantId, itemId, status, quantity: { gt: 0 } },
      include: { location: true },
    });
    rows.sort((a, b) => {
      const ap = a.locationId === preferredLocationId ? 0 : 1;
      const bp = b.locationId === preferredLocationId ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (a.location.isDefault !== b.location.isDefault) {
        return a.location.isDefault ? -1 : 1;
      }
      return a.location.name.localeCompare(b.location.name);
    });
    for (const row of rows) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const take = Decimal.min(remaining, row.quantity);
      await tx.itemStockLocation.update({
        where: { id: row.id },
        data: { quantity: row.quantity.minus(take).toString() },
      });
      remaining = remaining.minus(take);
    }
  }
}

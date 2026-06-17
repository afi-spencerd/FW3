import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type ItemQualitySpec,
  type Lot,
  type LotOrigin,
  type LotSummary,
  type PhysicalForm,
  QC_SUITE_BY_FORM,
  QC_TEST_KIND,
  type QcLotStatus,
  type QcTestType,
  type RecordQualityResults,
  type SetItemQualitySpecs,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { StockService } from "../stock/stock.service";
import { evaluateResult, type SpecLike } from "./quality-eval";

type LotWithRelations = Prisma.ReceivedLotGetPayload<{
  include: { item: true; results: true };
}>;

@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async listLots(
    tenantId: string,
    status?: QcLotStatus,
  ): Promise<LotSummary[]> {
    const lots = await this.prisma.receivedLot.findMany({
      where: { tenantId, ...(status ? { qcStatus: status } : {}) },
      include: { item: true, results: true },
      orderBy: { receivedAt: "desc" },
    });
    return lots.map((lot) => {
      const dto = this.toDto(lot);
      const { results, ...summary } = dto;
      return {
        ...summary,
        testCount: results.length,
        passCount: results.filter((r) => r.passed === true).length,
      };
    });
  }

  async getLot(tenantId: string, id: string): Promise<Lot> {
    return this.toDto(await this.loadLot(this.prisma, tenantId, id));
  }

  /** Record measured values; pass/fail is computed against the item's spec. */
  async recordResults(
    user: AuthenticatedUser,
    lotId: string,
    input: RecordQualityResults,
  ): Promise<Lot> {
    await this.prisma.$transaction(async (tx) => {
      const lot = await this.loadLot(tx, user.tenantId, lotId);
      if (lot.qcStatus !== "PENDING") {
        throw new BadRequestException(`Cannot record results on a ${lot.qcStatus} lot`);
      }
      const specs = await this.specMap(tx, user.tenantId, lot.itemId);

      for (const result of input.results) {
        const passed =
          result.passed ??
          evaluateResult(result.testType, result.measuredValue, specs[result.testType]);
        await tx.qualityTestResult.upsert({
          where: {
            receivedLotId_testType: {
              receivedLotId: lotId,
              testType: result.testType,
            },
          },
          create: {
            receivedLotId: lotId,
            testType: result.testType,
            measuredValue: result.measuredValue,
            passed,
            notes: result.notes ?? null,
          },
          update: {
            measuredValue: result.measuredValue,
            passed,
            notes: result.notes ?? null,
          },
        });
      }
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ReceivedLot",
        entityId: lotId,
        action: "UPDATE",
        after: { recordedResults: input.results },
      });
    });
    return this.getLot(user.tenantId, lotId);
  }

  /** Approve: every test recorded, none failed -> move QUARANTINE -> INV (usable). */
  async approve(user: AuthenticatedUser, lotId: string): Promise<Lot> {
    await this.prisma.$transaction(async (tx) => {
      const lot = await this.loadLot(tx, user.tenantId, lotId);
      if (lot.qcStatus !== "PENDING") {
        throw new BadRequestException(`Lot is already ${lot.qcStatus}`);
      }
      if (lot.results.some((r) => r.passed !== true)) {
        throw new BadRequestException(
          "All QC tests must pass before approval (record numeric values; pass each judgment test)",
        );
      }
      // Received lots move QUARANTINE -> INV on approval. Production lots stay in
      // FG_WIP (the FG is in the vat); approval just makes them eligible to pack off.
      if (lot.origin === "RECEIPT") {
        await this.stock.transfer(
          tx,
          user.tenantId,
          lot.itemId,
          "QUARANTINE",
          "INV",
          lot.quantity.toString(),
          {
            docType: "PURCHASE_ORDER",
            docId: lot.purchaseOrderId ?? undefined,
            note: `QC approved lot ${lot.supplierLotNumber}`,
          },
        );
      }
      await tx.receivedLot.update({
        where: { id: lotId },
        data: { qcStatus: "APPROVED", reviewedAt: new Date(), reviewedById: user.id },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ReceivedLot",
        entityId: lotId,
        action: "UPDATE",
        after: { qcStatus: "APPROVED" },
      });
    });
    return this.getLot(user.tenantId, lotId);
  }

  /** Reject: lot stays in quarantine, flagged REJECTED (not usable). */
  async reject(
    user: AuthenticatedUser,
    lotId: string,
    reason?: string,
  ): Promise<Lot> {
    await this.prisma.$transaction(async (tx) => {
      const lot = await this.loadLot(tx, user.tenantId, lotId);
      if (lot.qcStatus !== "PENDING") {
        throw new BadRequestException(`Lot is already ${lot.qcStatus}`);
      }
      await tx.receivedLot.update({
        where: { id: lotId },
        data: {
          qcStatus: "REJECTED",
          rejectionReason: reason ?? null,
          reviewedAt: new Date(),
          reviewedById: user.id,
        },
      });
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "ReceivedLot",
        entityId: lotId,
        action: "UPDATE",
        after: { qcStatus: "REJECTED", reason },
      });
    });
    return this.getLot(user.tenantId, lotId);
  }

  async getItemSpecs(tenantId: string, itemId: string): Promise<ItemQualitySpec[]> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true, physicalForm: true },
    });
    if (!item) throw new NotFoundException("Inventory item not found");
    const rows = await this.prisma.itemQualitySpec.findMany({
      where: { tenantId, itemId },
    });
    const byType = new Map(rows.map((r) => [r.testType, r]));
    return QC_SUITE_BY_FORM[item.physicalForm as PhysicalForm].map((testType) => {
      const row = byType.get(testType);
      return {
        testType,
        kind: QC_TEST_KIND[testType],
        minValue: row?.minValue?.toString() ?? null,
        maxValue: row?.maxValue?.toString() ?? null,
        expectedValue: row?.expectedValue ?? null,
      };
    });
  }

  /** Replace the full spec set for an item. */
  async setItemSpecs(
    user: AuthenticatedUser,
    itemId: string,
    input: SetItemQualitySpecs,
  ): Promise<ItemQualitySpec[]> {
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: { id: itemId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!item) throw new NotFoundException("Inventory item not found");
      await tx.itemQualitySpec.deleteMany({ where: { tenantId: user.tenantId, itemId } });
      for (const spec of input.specs) {
        // Skip empty specs (no criteria provided).
        if (!spec.minValue && !spec.maxValue && !spec.expectedValue) continue;
        await tx.itemQualitySpec.create({
          data: {
            tenantId: user.tenantId,
            itemId,
            testType: spec.testType,
            minValue: spec.minValue ?? null,
            maxValue: spec.maxValue ?? null,
            expectedValue: spec.expectedValue ?? null,
          },
        });
      }
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "InventoryItem",
        entityId: itemId,
        action: "UPDATE",
        after: { qualitySpecs: input.specs },
      });
    });
    return this.getItemSpecs(user.tenantId, itemId);
  }

  private async specMap(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemId: string,
  ): Promise<Partial<Record<QcTestType, SpecLike>>> {
    const rows = await tx.itemQualitySpec.findMany({ where: { tenantId, itemId } });
    const map: Partial<Record<QcTestType, SpecLike>> = {};
    for (const r of rows) {
      map[r.testType as QcTestType] = {
        minValue: r.minValue?.toString() ?? null,
        maxValue: r.maxValue?.toString() ?? null,
        expectedValue: r.expectedValue,
      };
    }
    return map;
  }

  private async loadLot(
    db: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<LotWithRelations> {
    const lot = await db.receivedLot.findFirst({
      where: { id, tenantId },
      include: { item: true, results: true },
    });
    if (!lot) throw new NotFoundException("Received lot not found");
    return lot;
  }

  private toDto(lot: LotWithRelations): Lot {
    const byType = new Map(lot.results.map((r) => [r.testType, r]));
    return {
      id: lot.id,
      origin: lot.origin as LotOrigin,
      itemId: lot.itemId,
      itemSku: lot.item.sku,
      itemName: lot.item.name,
      vendorName: lot.vendorName,
      purchaseOrderNumber: lot.purchaseOrderNumber,
      workOrderNumber: lot.workOrderNumber,
      lotNumber: lot.supplierLotNumber,
      quantity: lot.quantity.toString(),
      packedQty: lot.packedQty.toString(),
      unitCost: lot.unitCost.toString(),
      qcStatus: lot.qcStatus as QcLotStatus,
      receivedAt: lot.receivedAt.toISOString(),
      reviewedAt: lot.reviewedAt ? lot.reviewedAt.toISOString() : null,
      rejectionReason: lot.rejectionReason,
      results: QC_SUITE_BY_FORM[lot.item.physicalForm as PhysicalForm].map(
        (testType) => {
          const r = byType.get(testType);
          return {
            testType,
            kind: QC_TEST_KIND[testType],
            measuredValue: r?.measuredValue ?? null,
            passed: r?.passed ?? null,
            notes: r?.notes ?? null,
          };
        },
      ),
    };
  }
}

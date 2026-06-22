import { Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import type {
  AuthenticatedUser,
  ComplianceStatus,
  FgDerived,
  FgRegulatory,
  FgRegulatorySummary,
  IfraCategory,
  Prop65Status,
} from "@fw3/shared-types";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import {
  FormPakClient,
  type FormPakComponentInput,
} from "../formpak/formpak.client";

type FormulaWithLines = Prisma.FormulaGetPayload<{ include: { lines: true } }>;

@Injectable()
export class RegulatoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly formpak: FormPakClient,
  ) {}

  /** Full FG regulatory profile: live-derived from RMs + the FormPak+ snapshot. */
  async getProfile(tenantId: string, itemId: string): Promise<FgRegulatory> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException("Item not found");
    const derived = await this.derive(tenantId, itemId);
    const formPak = await this.readSnapshot(tenantId, itemId);
    return { itemId, derived, formPak };
  }

  /** Compliance summary per FG (those with a FormPak+ snapshot) for listing badges. */
  async summary(tenantId: string): Promise<FgRegulatorySummary[]> {
    const rows = await this.prisma.fgRegulatoryProfile.findMany({
      where: { tenantId },
    });
    return rows.map((r) => ({
      itemId: r.itemId,
      complianceStatus: r.complianceStatus as ComplianceStatus,
      flashPointC: r.flashPointC === null ? null : r.flashPointC.toString(),
      syncedAt: r.syncedAt?.toISOString() ?? null,
    }));
  }

  /** Pull the FormPak+ profile (real or stub) and persist it as the snapshot. */
  async refresh(user: AuthenticatedUser, itemId: string): Promise<FgRegulatory> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId: user.tenantId },
    });
    if (!item) throw new NotFoundException("Item not found");

    const derived = await this.derive(user.tenantId, itemId);
    const components: FormPakComponentInput[] = derived.components.map((c) => ({
      sku: c.sku,
      name: c.name,
      casNumber: c.casNumber,
      effectivePercent: c.effectivePercent,
    }));
    const fp = await this.formpak.getRegulatoryProfile({
      sku: item.sku,
      name: item.name,
      components,
    });

    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.fgRegulatoryProfile.upsert({
        where: { itemId },
        create: {
          tenantId: user.tenantId,
          itemId,
          flashPointC: fp.flashPointC,
          complianceStatus: fp.complianceStatus,
          allergenDeclaration: fp.allergenDeclaration,
          certificateUrl: fp.certificateUrl,
          formPakRef: fp.formPakRef,
          syncedAt: new Date(),
        },
        update: {
          flashPointC: fp.flashPointC,
          complianceStatus: fp.complianceStatus,
          allergenDeclaration: fp.allergenDeclaration,
          certificateUrl: fp.certificateUrl,
          formPakRef: fp.formPakRef,
          syncedAt: new Date(),
        },
      });
      // IFRA QRA levels replace wholesale on each refresh.
      await tx.fgIfraLevel.deleteMany({ where: { profileId: profile.id } });
      if (fp.ifraLevels.length) {
        await tx.fgIfraLevel.createMany({
          data: fp.ifraLevels.map((l) => ({
            tenantId: user.tenantId,
            profileId: profile.id,
            category: l.category,
            maxPercent: l.maxPercent,
          })),
        });
      }
      await this.audit.record(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        entityType: "FgRegulatoryProfile",
        entityId: itemId,
        action: "UPDATE",
        after: { compliance: fp.complianceStatus, formPakRef: fp.formPakRef, via: "formpak" },
      });
    });

    return this.getProfile(user.tenantId, itemId);
  }

  // ---- internals ----

  private async readSnapshot(tenantId: string, itemId: string) {
    const p = await this.prisma.fgRegulatoryProfile.findFirst({
      where: { tenantId, itemId },
      include: { ifraLevels: { orderBy: { category: "asc" } } },
    });
    if (!p) return null;
    return {
      flashPointC: p.flashPointC === null ? null : p.flashPointC.toString(),
      complianceStatus: p.complianceStatus as ComplianceStatus,
      allergenDeclaration: p.allergenDeclaration,
      certificateUrl: p.certificateUrl,
      formPakRef: p.formPakRef,
      ifraLevels: p.ifraLevels.map((l) => ({
        category: l.category as IfraCategory,
        maxPercent: l.maxPercent.toString(),
      })),
      syncedAt: p.syncedAt?.toISOString() ?? null,
    };
  }

  /** The formula used for roll-up: active first, then highest version. */
  private async activeFormula(
    tenantId: string,
    finishedGoodId: string,
  ): Promise<FormulaWithLines | null> {
    return this.prisma.formula.findFirst({
      where: { tenantId, finishedGoodId },
      include: { lines: true },
      orderBy: [{ isActive: "desc" }, { version: "desc" }],
    });
  }

  /**
   * Roll the RM make-up up to the finished good. Walks the formula DAG; base
   * components (SEMI_FINISHED with their own formula) recurse with multiplied
   * percentages, so each leaf RM's *effective fraction* in the FG is the product
   * of percentages along its path (summed across paths).
   */
  async derive(tenantId: string, itemId: string): Promise<FgDerived> {
    const top = await this.activeFormula(tenantId, itemId);
    const empty: FgDerived = {
      hasFormula: false,
      formulaName: null,
      formulaVersion: null,
      components: [],
      casList: [],
      prop65Status: "UNKNOWN",
      prop65Contributors: [],
      ifraDerived: [],
    };
    if (!top) return empty;

    const fractions = new Map<string, Decimal>(); // leaf RM itemId -> effective fraction
    await this.expand(tenantId, top, new Decimal(1), fractions, new Set([itemId]));

    const ids = [...fractions.keys()];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids }, tenantId },
      include: { ifraLimits: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    const components = ids
      .map((id) => {
        const it = byId.get(id);
        const frac = fractions.get(id) ?? new Decimal(0);
        return {
          itemId: id,
          sku: it?.sku ?? "?",
          name: it?.name ?? "(unknown)",
          casNumber: it?.casNumber ?? null,
          effectivePercent: frac.times(100).toDecimalPlaces(4).toString(),
          _frac: frac,
        };
      })
      .sort((a, b) => b._frac.comparedTo(a._frac));

    const casList = [
      ...new Set(items.map((i) => i.casNumber).filter((c): c is string => !!c)),
    ];

    // Prop65 roll-up: any LISTED -> LISTED; else any UNKNOWN -> UNKNOWN; else NOT_LISTED.
    const listed = items.filter((i) => i.prop65Status === "LISTED");
    const prop65Status: Prop65Status = listed.length
      ? "LISTED"
      : items.some((i) => i.prop65Status === "UNKNOWN") || items.length === 0
        ? "UNKNOWN"
        : "NOT_LISTED";
    const prop65Contributors = listed.map((i) => ({
      sku: i.sku,
      notes: i.prop65Notes,
    }));

    // Derived IFRA: FG max-in-finished per category = min over RMs of (limit ÷ fraction).
    const ifra = new Map<string, { max: Decimal; sku: string }>();
    for (const it of items) {
      const f = fractions.get(it.id);
      if (!f || f.lte(0)) continue;
      for (const lim of it.ifraLimits) {
        const cap = Decimal.min(new Decimal(lim.maxPercent.toString()).div(f), 100);
        const cur = ifra.get(lim.category);
        if (!cur || cap.lessThan(cur.max)) ifra.set(lim.category, { max: cap, sku: it.sku });
      }
    }
    const ifraDerived = [...ifra.entries()]
      .map(([category, v]) => ({
        category: category as IfraCategory,
        maxPercent: v.max.toDecimalPlaces(4).toString(),
        limitingSku: v.sku,
      }))
      .sort((a, b) => a.category.localeCompare(b.category));

    return {
      hasFormula: true,
      formulaName: top.name,
      formulaVersion: top.version,
      components: components.map(({ _frac, ...c }) => c),
      casList,
      prop65Status,
      prop65Contributors,
      ifraDerived,
    };
  }

  private async expand(
    tenantId: string,
    formula: FormulaWithLines,
    mult: Decimal,
    acc: Map<string, Decimal>,
    path: Set<string>,
  ): Promise<void> {
    const compIds = formula.lines.map((l) => l.rawMaterialId);
    const comps = await this.prisma.inventoryItem.findMany({
      where: { id: { in: compIds }, tenantId },
      select: { id: true, itemType: true },
    });
    const typeById = new Map(comps.map((c) => [c.id, c.itemType]));

    for (const line of formula.lines) {
      const frac = mult.times(new Decimal(line.percentage.toString()).div(100));
      const isBase = typeById.get(line.rawMaterialId) === "SEMI_FINISHED";
      const child =
        isBase && !path.has(line.rawMaterialId)
          ? await this.activeFormula(tenantId, line.rawMaterialId)
          : null;
      if (child) {
        path.add(line.rawMaterialId);
        await this.expand(tenantId, child, frac, acc, path);
        path.delete(line.rawMaterialId);
      } else {
        // Leaf: a raw material, or a base with no formula to expand.
        acc.set(line.rawMaterialId, (acc.get(line.rawMaterialId) ?? new Decimal(0)).plus(frac));
      }
    }
  }
}

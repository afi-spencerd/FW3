/**
 * Seed: one demo tenant, the permission catalogue, the built-in roles, a dev
 * admin user (mapped to a fixed OIDC sub for local dev login), and a few demo
 * inventory items. Idempotent — safe to re-run.
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaMssql } from "@prisma/adapter-mssql";
import {
  ALL_PERMISSIONS,
  BUILTIN_ROLES,
  type BuiltinRoleName,
  composeLocationCode,
  type LocationKind,
  locationSegment,
  rackSide,
} from "@fw3/shared-types";
import { PrismaClient } from "../src/generated/prisma/client";
import { mssqlConfigFromUrl } from "../src/database/mssql-config";
import { toPounds, unitCostToPounds } from "../src/inventory/units";

loadEnv({ path: path.resolve(__dirname, "../../../.env") });

// Regulatory data is meaningful only for raw materials; other tiers carry the
// defaults (productionUse true, prop65 UNKNOWN, no IFRA limits).
const DEMO_ITEMS = [
  // Ambroxan and Vanillin are crystalline solids -> SOLID QC suite (odor, appearance, melting point).
  { sku: "RM-AMBROXAN", name: "Ambroxan", type: "RAW_MATERIAL", form: "SOLID", uom: "LB", qty: "1.3000", cost: "210.0000", price: "0.0000",
    cas: "6790-58-5", flash: "150.00", prop65: "NOT_LISTED", prop65Notes: null, productionUse: true,
    ifra: [{ category: "5A", maxPercent: "21.0000" }, { category: "4", maxPercent: "30.0000" }] },
  { sku: "RM-HEDIONE", name: "Hedione", type: "RAW_MATERIAL", form: "LIQUID", uom: "LB", qty: "44.5000", cost: "38.5000", price: "0.0000",
    cas: "24851-98-7", flash: "113.00", prop65: "NOT_LISTED", prop65Notes: null, productionUse: true, ifra: [] },
  { sku: "RM-ISO-E-SUPER", name: "Iso E Super", type: "RAW_MATERIAL", form: "LIQUID", uom: "KG", qty: "12.0000", cost: "33.0000", price: "0.0000",
    cas: "54464-57-2", flash: "112.00", prop65: "NOT_LISTED", prop65Notes: null, productionUse: true,
    ifra: [{ category: "1", maxPercent: "1.3900" }, { category: "5A", maxPercent: "21.4000" }] },
  { sku: "RM-VANILLIN", name: "Vanillin", type: "RAW_MATERIAL", form: "SOLID", uom: "LB", qty: "8.2500", cost: "19.7500", price: "0.0000",
    cas: "121-33-5", flash: "153.00", prop65: "NOT_LISTED", prop65Notes: null, productionUse: true, ifra: [] },
  { sku: "RM-IPM", name: "Isopropyl Myristate (IPM)", type: "RAW_MATERIAL", form: "LIQUID", uom: "LB", qty: "120.0000", cost: "3.2500", price: "0.0000",
    cas: "110-27-0", flash: "153.00", prop65: "NOT_LISTED", prop65Notes: null, productionUse: true, ifra: [] },
  // Stocked for R&D / lab evaluation only — must NOT appear in the production compounder tool.
  { sku: "RM-OAKMOSS-ABS", name: "Oakmoss Absolute (R&D)", type: "RAW_MATERIAL", form: "LIQUID", uom: "LB", qty: "0.5000", cost: "420.0000", price: "0.0000",
    cas: "9000-50-4", flash: "100.00", prop65: "LISTED", prop65Notes: "Contains atranol/chloroatranol allergens", productionUse: false,
    ifra: [{ category: "4", maxPercent: "0.1000" }] },
  { sku: "SF-AMBROXAN-10", name: "Ambroxan 10% Solution", type: "SEMI_FINISHED", form: "LIQUID", uom: "LB", qty: "5.0000", cost: "23.7000", price: "0.0000" },
  { sku: "FG-NOIR-01", name: "Noir Extrait (fragrance)", type: "FINISHED_GOOD", form: "LIQUID", uom: "LB", qty: "6.0000", cost: "62.4000", price: "180.0000" },
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const prisma = new PrismaClient({
    adapter: new PrismaMssql(mssqlConfigFromUrl(url)),
  });

  try {
    // 1. Permission catalogue (global).
    for (const key of ALL_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
    }

    // 2. Demo tenant.
    const tenant = await prisma.tenant.upsert({
      where: { slug: "demo" },
      create: { name: "Demo Company", slug: "demo" },
      update: {},
    });

    // 3. Built-in roles + their permissions.
    for (const roleName of Object.keys(BUILTIN_ROLES) as BuiltinRoleName[]) {
      const role = await prisma.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
        create: { tenantId: tenant.id, name: roleName },
        update: {},
      });
      for (const permKey of BUILTIN_ROLES[roleName]) {
        const perm = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          create: { roleId: role.id, permissionId: perm.id },
          update: {},
        });
      }
    }

    // 4. Dev admin user (mapped to a fixed sub so local dev login can resolve it).
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { tenantId_name: { tenantId: tenant.id, name: "admin" } },
    });
    const admin = await prisma.user.upsert({
      where: { tenantId_idpSub: { tenantId: tenant.id, idpSub: "dev-admin" } },
      create: {
        tenantId: tenant.id,
        idpSub: "dev-admin",
        email: "admin@demo.local",
        displayName: "Dev Admin",
      },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
      create: { userId: admin.id, roleId: adminRole.id },
      update: {},
    });

    // 5. Physical locations: a typed-level tree per building.
    //    BUILDING (bbb) -> AISLE (a) -> RACK (bbb-a-n00), plus a Receiving area.
    // Rebuilt from scratch each run so the hierarchy stays clean.
    await prisma.locationMove.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.itemStockLocation.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.scrapRecord.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.cycleCountLine.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.cycleCount.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.receivedLot.updateMany({
      where: { tenantId: tenant.id },
      data: { locationId: null },
    });
    await prisma.location.deleteMany({ where: { tenantId: tenant.id } });

    interface LocNode {
      id: string;
      code: string;
      buildingId: string;
    }
    const makeLocation = async (
      kind: LocationKind,
      name: string,
      value: string,
      parent: LocNode | null,
      flags: { isDefault?: boolean; isReceiving?: boolean } = {},
    ): Promise<LocNode> => {
      const segment = locationSegment(kind, value);
      const code = composeLocationCode(kind, parent?.code ?? null, value);
      const side = kind === "RACK" ? rackSide(Number(value)) : null;
      const row = await prisma.location.create({
        data: {
          tenantId: tenant.id,
          kind,
          name,
          segment,
          code,
          side,
          parentId: parent?.id ?? null,
          buildingId: kind === "BUILDING" ? null : (parent?.buildingId ?? null),
          isDefault: flags.isDefault ?? false,
          isReceiving: flags.isReceiving ?? false,
        },
      });
      if (kind === "BUILDING") {
        await prisma.location.update({
          where: { id: row.id },
          data: { buildingId: row.id },
        });
        return { id: row.id, code, buildingId: row.id };
      }
      return { id: row.id, code, buildingId: parent?.buildingId ?? row.id };
    };

    // Warehouse 75: aisle A with racks 1 (left, default storage) & 2 (right),
    // plus a receiving dock.
    const b75 = await makeLocation("BUILDING", "Warehouse 75", "075", null);
    const b75AisleA = await makeLocation("AISLE", "Aisle A", "A", b75);
    const defaultRack = await makeLocation("RACK", "Rack 1", "1", b75AisleA, {
      isDefault: true,
    });
    await makeLocation("RACK", "Rack 2", "2", b75AisleA);
    await makeLocation("AREA", "Receiving", "RECV", b75, { isReceiving: true });

    // Warehouse 12: aisle A with rack 1 (default), plus a receiving dock — shows
    // that each building has its own "Receiving".
    const b12 = await makeLocation("BUILDING", "Warehouse 12", "012", null);
    const b12AisleA = await makeLocation("AISLE", "Aisle A", "A", b12);
    await makeLocation("RACK", "Rack 1", "1", b12AisleA, { isDefault: true });
    await makeLocation("AREA", "Receiving", "RECV", b12, { isReceiving: true });

    // 6. Demo inventory items (with an opening INV stock position). Pounds is
    // canonical, so a KG-handled item's opening qty/cost are converted to lb.
    for (const item of DEMO_ITEMS) {
      const qtyLb = toPounds(item.qty, item.uom);
      const costLb = unitCostToPounds(item.cost, item.uom);
      // Regulatory fields are present only on the raw-material entries.
      const reg = "cas" in item
        ? {
            casNumber: item.cas,
            flashPointC: item.flash,
            prop65Status: item.prop65,
            prop65Notes: item.prop65Notes,
            productionUse: item.productionUse,
          }
        : {};
      const created = await prisma.inventoryItem.upsert({
        where: { tenantId_sku: { tenantId: tenant.id, sku: item.sku } },
        create: {
          tenantId: tenant.id,
          sku: item.sku,
          name: item.name,
          itemType: item.type,
          physicalForm: item.form,
          unitOfMeasure: item.uom,
          salesPrice: item.price,
          ...reg,
          // Item master only — opening quantity/cost go to ItemStock below.
        },
        update: {
          physicalForm: item.form,
          unitOfMeasure: item.uom,
          ...reg,
        },
      });
      // IFRA usage limits (replace-set so re-seeding is idempotent).
      const ifra = "ifra" in item ? item.ifra : [];
      await prisma.ifraCategoryLimit.deleteMany({ where: { itemId: created.id } });
      for (const limit of ifra) {
        await prisma.ifraCategoryLimit.create({
          data: {
            tenantId: tenant.id,
            itemId: created.id,
            category: limit.category,
            maxPercent: limit.maxPercent,
          },
        });
      }
      await prisma.itemStock.upsert({
        where: { itemId_status: { itemId: created.id, status: "INV" } },
        create: {
          tenantId: tenant.id,
          itemId: created.id,
          status: "INV",
          quantity: qtyLb,
          avgCost: costLb,
        },
        update: { quantity: qtyLb, avgCost: costLb },
      });
      // Opening INV sits at Warehouse 75's default rack so the per-location
      // breakdown ties out to ItemStock from the start.
      await prisma.itemStockLocation.upsert({
        where: {
          itemId_status_locationId: {
            itemId: created.id,
            status: "INV",
            locationId: defaultRack.id,
          },
        },
        create: {
          tenantId: tenant.id,
          itemId: created.id,
          status: "INV",
          locationId: defaultRack.id,
          quantity: qtyLb,
        },
        update: { quantity: qtyLb },
      });
    }

    // 7. Demo formulas (percentages sum to 100): a base, and the finished good.
    const seedFormula = async (
      targetSku: string,
      name: string,
      lineDefs: { sku: string; percentage: string }[],
    ): Promise<void> => {
      const target = await prisma.inventoryItem.findUniqueOrThrow({
        where: { tenantId_sku: { tenantId: tenant.id, sku: targetSku } },
      });
      const lines = [];
      for (const [index, def] of lineDefs.entries()) {
        const material = await prisma.inventoryItem.findUniqueOrThrow({
          where: { tenantId_sku: { tenantId: tenant.id, sku: def.sku } },
        });
        lines.push({
          rawMaterialId: material.id,
          percentage: def.percentage,
          sortOrder: index,
        });
      }
      const existing = await prisma.formula.findUnique({
        where: {
          tenantId_finishedGoodId_version: {
            tenantId: tenant.id,
            finishedGoodId: target.id,
            version: 1,
          },
        },
      });
      if (!existing) {
        await prisma.formula.create({
          data: {
            tenantId: tenant.id,
            finishedGoodId: target.id,
            name,
            version: 1,
            lines: { create: lines },
          },
        });
      }
    };

    // A base (semi-finished): 10% Ambroxan in IPM.
    await seedFormula("SF-AMBROXAN-10", "Ambroxan 10% Solution", [
      { sku: "RM-AMBROXAN", percentage: "10" },
      { sku: "RM-IPM", percentage: "90" },
    ]);
    // The finished fragrance.
    await seedFormula("FG-NOIR-01", "Noir Extrait v1", [
      { sku: "RM-AMBROXAN", percentage: "10" },
      { sku: "RM-HEDIONE", percentage: "40" },
      { sku: "RM-ISO-E-SUPER", percentage: "35" },
      { sku: "RM-VANILLIN", percentage: "15" },
    ]);

    // 8. A vendor + an open purchase order (demo).
    const vendor = await prisma.vendor.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: "Aroma Supply Co" } },
      create: {
        tenantId: tenant.id,
        name: "Aroma Supply Co",
        code: "ASC",
        email: "orders@aromasupply.example",
      },
      update: {},
    });
    const existingPo = await prisma.purchaseOrder.findUnique({
      where: { tenantId_poNumber: { tenantId: tenant.id, poNumber: "PO-1001" } },
    });
    if (!existingPo) {
      const ambroxan = await prisma.inventoryItem.findUniqueOrThrow({
        where: { tenantId_sku: { tenantId: tenant.id, sku: "RM-AMBROXAN" } },
      });
      const ipm = await prisma.inventoryItem.findUniqueOrThrow({
        where: { tenantId_sku: { tenantId: tenant.id, sku: "RM-IPM" } },
      });
      await prisma.purchaseOrder.create({
        data: {
          tenantId: tenant.id,
          vendorId: vendor.id,
          poNumber: "PO-1001",
          status: "OPEN",
          lines: {
            create: [
              { itemId: ambroxan.id, quantityOrdered: "5.0000", unitCost: "215.0000", sortOrder: 0 },
              { itemId: ipm.id, quantityOrdered: "50.0000", unitCost: "3.1000", sortOrder: 1 },
            ],
          },
        },
      });
    }

    // 9. A customer + an open sales order for the finished good (demo).
    const customer = await prisma.customer.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: "Maison Aurelia" } },
      create: {
        tenantId: tenant.id,
        name: "Maison Aurelia",
        code: "MA",
        email: "buyer@maisonaurelia.example",
      },
      update: {},
    });
    const existingSo = await prisma.salesOrder.findUnique({
      where: { tenantId_soNumber: { tenantId: tenant.id, soNumber: "SO-2001" } },
    });
    if (!existingSo) {
      const noir = await prisma.inventoryItem.findUniqueOrThrow({
        where: { tenantId_sku: { tenantId: tenant.id, sku: "FG-NOIR-01" } },
      });
      await prisma.salesOrder.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          soNumber: "SO-2001",
          status: "OPEN",
          lines: {
            create: [
              { itemId: noir.id, quantityOrdered: "3.0000", unitPrice: "180.0000", sortOrder: 0 },
            ],
          },
        },
      });
    }

    // 10. Demo containers (packaging) with opening stock. Two share a capacity
    // (red vs white jug) to mirror "customer requests a specific container".
    const DEMO_CONTAINERS = [
      { sku: "CT-DRUM-55", name: "55 gal steel drum", type: "DRUM", cap: "450.0000", cost: "48.0000", qty: "20" },
      { sku: "CT-JUG-RED", name: "5 gal plastic jug (red)", type: "JUG", cap: "40.0000", cost: "6.5000", qty: "150" },
      { sku: "CT-JUG-WHITE", name: "5 gal plastic jug (white)", type: "JUG", cap: "40.0000", cost: "6.5000", qty: "150" },
      { sku: "CT-BOTTLE-1L", name: "1 L glass bottle", type: "BOTTLE", cap: "2.2000", cost: "1.2000", qty: "500" },
    ] as const;
    for (const ct of DEMO_CONTAINERS) {
      const container = await prisma.container.upsert({
        where: { tenantId_sku: { tenantId: tenant.id, sku: ct.sku } },
        create: {
          tenantId: tenant.id,
          sku: ct.sku,
          name: ct.name,
          containerType: ct.type,
          capacityLb: ct.cap,
          standardCost: ct.cost,
        },
        update: { capacityLb: ct.cap, standardCost: ct.cost },
      });
      await prisma.containerStock.upsert({
        where: { containerId: container.id },
        create: { tenantId: tenant.id, containerId: container.id, quantity: ct.qty, avgCost: ct.cost },
        update: { quantity: ct.qty, avgCost: ct.cost },
      });
    }

    // 11. Demo company holidays (US). Recurring rules cover every year; Easter
    // is a movable feast, seeded as a one-off explicit date.
    const DEMO_HOLIDAYS = [
      { name: "New Year's Day", ruleType: "FIXED", month: 1, day: 1 },
      { name: "Martin Luther King Jr. Day", ruleType: "NTH_WEEKDAY", month: 1, weekday: 1, nth: 3 },
      { name: "Presidents' Day", ruleType: "NTH_WEEKDAY", month: 2, weekday: 1, nth: 3 },
      { name: "Easter", ruleType: "EXPLICIT", date: "2026-04-05" },
      { name: "Memorial Day", ruleType: "NTH_WEEKDAY", month: 5, weekday: 1, nth: -1 },
      { name: "Independence Day", ruleType: "FIXED", month: 7, day: 4 },
      { name: "Labor Day", ruleType: "NTH_WEEKDAY", month: 9, weekday: 1, nth: 1 },
      { name: "Thanksgiving", ruleType: "NTH_WEEKDAY", month: 11, weekday: 4, nth: 4 },
      { name: "Christmas Eve", ruleType: "FIXED", month: 12, day: 24 },
      { name: "Christmas Day", ruleType: "FIXED", month: 12, day: 25 },
    ] as const;
    for (const h of DEMO_HOLIDAYS) {
      // No natural unique key (name isn't constrained) — guard to stay idempotent.
      const existing = await prisma.companyHoliday.findFirst({
        where: { tenantId: tenant.id, name: h.name },
      });
      if (existing) continue;
      await prisma.companyHoliday.create({
        data: {
          tenantId: tenant.id,
          name: h.name,
          ruleType: h.ruleType,
          month: "month" in h ? h.month : null,
          day: "day" in h ? h.day : null,
          weekday: "weekday" in h ? h.weekday : null,
          nth: "nth" in h ? h.nth : null,
          date: "date" in h ? new Date(`${h.date}T00:00:00.000Z`) : null,
        },
      });
    }

    console.log(`Seed complete. Tenant=${tenant.id} (slug=demo), admin user=${admin.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

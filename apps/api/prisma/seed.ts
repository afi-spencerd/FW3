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
} from "@fw3/shared-types";
import { PrismaClient } from "../src/generated/prisma/client";
import { mssqlConfigFromUrl } from "../src/database/mssql-config";

loadEnv({ path: path.resolve(__dirname, "../../../.env") });

const DEMO_ITEMS = [
  { sku: "RM-AMBROXAN", name: "Ambroxan", type: "RAW_MATERIAL", uom: "LB", qty: "1.3000", cost: "210.0000", price: "0.0000" },
  { sku: "RM-HEDIONE", name: "Hedione", type: "RAW_MATERIAL", uom: "LB", qty: "44.5000", cost: "38.5000", price: "0.0000" },
  { sku: "RM-ISO-E-SUPER", name: "Iso E Super", type: "RAW_MATERIAL", uom: "KG", qty: "12.0000", cost: "33.0000", price: "0.0000" },
  { sku: "RM-VANILLIN", name: "Vanillin", type: "RAW_MATERIAL", uom: "LB", qty: "8.2500", cost: "19.7500", price: "0.0000" },
  { sku: "FG-NOIR-01", name: "Noir Extrait (fragrance)", type: "FINISHED_GOOD", uom: "LB", qty: "6.0000", cost: "62.4000", price: "180.0000" },
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

    // 5. Demo inventory items.
    for (const item of DEMO_ITEMS) {
      await prisma.inventoryItem.upsert({
        where: { tenantId_sku: { tenantId: tenant.id, sku: item.sku } },
        create: {
          tenantId: tenant.id,
          sku: item.sku,
          name: item.name,
          itemType: item.type,
          unitOfMeasure: item.uom,
          quantityOnHand: item.qty,
          unitCost: item.cost,
          salesPrice: item.price,
        },
        update: {},
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

import { z } from "zod";
import { moneyString } from "./money.js";

/**
 * Inventory item contracts — shared by the API (DTO validation) and the web
 * client (form validation + typed responses). The API is the source of truth;
 * the browser only does UX-level validation against these same schemas.
 */

/**
 * Handling/display unit for an item. Pounds is the single canonical unit for
 * everything stored and batched; an item flagged KG is merely *handled* in
 * kilograms (ordered/received/labelled in kg) — its stock is still stored in
 * pounds and shown with the kg equivalent. Conversion is done at the edges
 * (receipt) so the ledger never holds anything but pounds.
 */
export const UNITS_OF_MEASURE = ["LB", "KG"] as const;
export const unitOfMeasureSchema = z.enum(UNITS_OF_MEASURE);
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

/**
 * The exact conversion the business uses. Pounds is canonical; kilograms are
 * converted in: lb = kg × 2.20462262 (equivalently kg = lb ÷ 2.20462262).
 */
export const LB_PER_KG = "2.20462262";
export const KG_TO_LB_FORMULA = "lb = kg × 2.20462262";
export const LB_TO_KG_FORMULA = "kg = lb ÷ 2.20462262";

/** Display-only kilogram equivalent of a pounds quantity, trimmed to 4 dp. */
export function kgEquivalent(poundsQty: string): string {
  const kg = Number(poundsQty) / Number(LB_PER_KG);
  if (!Number.isFinite(kg)) return "0";
  return String(Math.round(kg * 10000) / 10000);
}

/**
 * Item tiers: raw materials (purchased ingredients), semi-finished "bases"
 * (solutions/mixtures — made from a formula AND usable in other formulas), and
 * finished goods (fragrances).
 */
export const ITEM_TYPES = ["RAW_MATERIAL", "SEMI_FINISHED", "FINISHED_GOOD"] as const;
export const itemTypeSchema = z.enum(ITEM_TYPES);
export type ItemType = (typeof ITEM_TYPES)[number];

/** Physical form — selects the QC acceptance-test suite. Crystals = SOLID. */
export const PHYSICAL_FORMS = ["LIQUID", "SOLID"] as const;
export const physicalFormSchema = z.enum(PHYSICAL_FORMS);
export type PhysicalForm = (typeof PHYSICAL_FORMS)[number];

/**
 * Fields a user can submit when creating an item. Note: quantity on hand and
 * unit (average) cost are NOT settable here — they are derived from the stock
 * ledger. A new item starts at zero; establish opening stock with an inventory
 * adjustment (which posts a transaction). salesPrice is a list price, not
 * ledger-derived, so it stays editable.
 */
export const createInventoryItemSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  itemType: itemTypeSchema,
  physicalForm: physicalFormSchema.default("LIQUID"),
  unitOfMeasure: unitOfMeasureSchema.default("LB"),
  salesPrice: moneyString.default("0"),
  active: z.boolean().default(true),
});

/** All fields optional on update; sku is immutable so it is intentionally omitted. */
export const updateInventoryItemSchema = createInventoryItemSchema
  .omit({ sku: true })
  .partial();

/** Shape returned to clients. Money/qty are strings (see money.ts). */
export const inventoryItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  itemType: itemTypeSchema,
  physicalForm: physicalFormSchema,
  unitOfMeasure: unitOfMeasureSchema,
  quantityOnHand: z.string(),
  unitCost: z.string(),
  salesPrice: z.string(),
  /** quantityOnHand * unitCost, computed server-side. */
  extendedValue: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const inventoryListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  itemType: itemTypeSchema.optional(),
  // Query strings: compare explicitly — z.coerce.boolean("false") would be true.
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const paginatedInventorySchema = z.object({
  items: z.array(inventoryItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type CreateInventoryItemInput = z.input<typeof createInventoryItemSchema>;
export type CreateInventoryItem = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItem = z.infer<typeof updateInventoryItemSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type PaginatedInventory = z.infer<typeof paginatedInventorySchema>;

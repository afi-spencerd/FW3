import { z } from "zod";
import { moneyString, quantityString } from "./money.js";

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
 * How the item maps to a QuickBooks item: an inventory part (quantity tracked),
 * a non-inventory part, or a service. Distinct from our RAW/SEMI/FINISHED tier.
 */
export const QB_ITEM_TYPES = ["INVENTORY", "NON_INVENTORY", "SERVICE"] as const;
export const qbItemTypeSchema = z.enum(QB_ITEM_TYPES);
export type QbItemType = (typeof QB_ITEM_TYPES)[number];

// ---- Raw-material regulatory data ----

/**
 * California Proposition 65 status for the material. UNKNOWN = not yet assessed;
 * NOT_LISTED = no listed chemicals; LISTED = contains a Prop-65 listed chemical
 * (a consumer warning may be required — capture which chemicals in prop65Notes).
 */
export const PROP65_STATUSES = ["UNKNOWN", "NOT_LISTED", "LISTED"] as const;
export const prop65StatusSchema = z.enum(PROP65_STATUSES);
export type Prop65Status = (typeof PROP65_STATUSES)[number];

/**
 * IFRA Standards use categories (49th Amendment). A raw material carries a
 * maximum-usage percentage per category — the highest concentration it may reach
 * in a finished product of that category. Categories with letter suffixes are
 * IFRA's own sub-categories (e.g. 5A–5D body lotions, 7A/7B, 10A/10B, 11A/11B).
 */
export const IFRA_CATEGORIES = [
  "1", "2", "3", "4",
  "5A", "5B", "5C", "5D",
  "6", "7A", "7B", "8", "9",
  "10A", "10B", "11A", "11B", "12",
] as const;
export const ifraCategorySchema = z.enum(IFRA_CATEGORIES);
export type IfraCategory = (typeof IFRA_CATEGORIES)[number];

/** Flash point in degrees Celsius — may be negative (volatile solvents), 2 dp. */
const flashPointString = z
  .string()
  .regex(/^-?\d{1,4}(\.\d{1,2})?$/, "must be a number (°C) with up to 2 places");

/** A percentage in [0, 100], up to 4 decimal places (IFRA usage limits). */
const percentString = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, "must be a percentage with up to 4 places")
  .refine((v) => Number(v) <= 100, "must not exceed 100");

/** One IFRA category usage limit on a raw material (max % in a finished good). */
export const ifraLimitInputSchema = z.object({
  category: ifraCategorySchema,
  maxPercent: percentString,
});
export const ifraLimitSchema = z.object({
  category: ifraCategorySchema,
  maxPercent: z.string(),
});

/**
 * Item master — the item's *definition*, separate from its inventory position.
 * Quantity on hand and average cost are NOT part of the master; they live in the
 * stock ledger (see InventoryPosition / StockPosition). The master is what syncs
 * to QuickBooks as an Item; inventory levels sync separately via transactions.
 */
export const createInventoryItemSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  itemType: itemTypeSchema,
  physicalForm: physicalFormSchema.default("LIQUID"),
  unitOfMeasure: unitOfMeasureSchema.default("LB"),
  salesPrice: moneyString.default("0"),
  // ---- QuickBooks item-master attributes ----
  qbItemType: qbItemTypeSchema.default("INVENTORY"),
  /** Standard/purchase cost for the item record (the moving-average cost lives in the ledger). */
  standardCost: moneyString.default("0"),
  purchaseDescription: z.string().trim().max(2000).optional(),
  /** QuickBooks account references, by full account name. */
  incomeAccount: z.string().trim().max(159).optional(),
  cogsAccount: z.string().trim().max(159).optional(),
  assetAccount: z.string().trim().max(159).optional(),
  active: z.boolean().default(true),
  /** Reorder threshold (usable on-hand); below it the item is flagged. Null = untracked. */
  reorderPoint: quantityString.nullish(),
  // ---- Raw-material regulatory attributes (only meaningful for RAW_MATERIAL) ----
  /**
   * Whether the material is used in production. R&D/lab-only materials are kept
   * in inventory but excluded from the production compounder dosing tool.
   */
  productionUse: z.boolean().default(true),
  /** CAS registry number (regulatory identity). */
  casNumber: z.string().trim().max(40).optional(),
  /** Flash point in °C (closed cup); omit if not applicable. */
  flashPointC: flashPointString.optional(),
  prop65Status: prop65StatusSchema.default("UNKNOWN"),
  /** Which listed chemical(s) / warning text, when prop65Status is LISTED. */
  prop65Notes: z.string().trim().max(500).optional(),
  /** IFRA usage limits; on update this array REPLACES the existing set. */
  ifraLimits: z.array(ifraLimitInputSchema).default([]),
});

/** All fields optional on update; sku is immutable so it is intentionally omitted. */
export const updateInventoryItemSchema = createInventoryItemSchema
  .omit({ sku: true })
  .partial();

/** Item master returned to clients — no inventory position (see InventoryPosition). */
export const inventoryItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  itemType: itemTypeSchema,
  physicalForm: physicalFormSchema,
  unitOfMeasure: unitOfMeasureSchema,
  salesPrice: z.string(),
  qbItemType: qbItemTypeSchema,
  standardCost: z.string(),
  purchaseDescription: z.string().nullable(),
  incomeAccount: z.string().nullable(),
  cogsAccount: z.string().nullable(),
  assetAccount: z.string().nullable(),
  active: z.boolean(),
  reorderPoint: z.string().nullable(),
  productionUse: z.boolean(),
  casNumber: z.string().nullable(),
  flashPointC: z.string().nullable(),
  prop65Status: prop65StatusSchema,
  prop65Notes: z.string().nullable(),
  ifraLimits: z.array(ifraLimitSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Create an item together with its opening balance — for stock already on hand
 * that never came through a PO (go-live balances, samples, found stock). Creates
 * the item and posts one opening IN adjustment, so no dummy PO is needed.
 */
export const openingStockSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  itemType: itemTypeSchema,
  physicalForm: physicalFormSchema.default("LIQUID"),
  unitOfMeasure: unitOfMeasureSchema.default("LB"),
  /** Opening quantity, in the item's handling unit; must be positive. */
  quantity: quantityString.refine((v) => Number(v) > 0, "must be greater than 0"),
  /** Unit cost the opening stock is valued at. */
  unitCost: moneyString,
  note: z.string().trim().max(500).optional(),
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

export type IfraLimitInput = z.infer<typeof ifraLimitInputSchema>;
export type IfraLimit = z.infer<typeof ifraLimitSchema>;
export type CreateInventoryItemInput = z.input<typeof createInventoryItemSchema>;
export type CreateInventoryItem = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItem = z.infer<typeof updateInventoryItemSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type OpeningStock = z.infer<typeof openingStockSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type PaginatedInventory = z.infer<typeof paginatedInventorySchema>;

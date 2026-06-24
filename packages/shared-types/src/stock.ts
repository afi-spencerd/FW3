import { z } from "zod";
import { moneyString, quantityString } from "./money.js";
import { itemTypeSchema, unitOfMeasureSchema } from "./inventory.js";

/**
 * Inventory status: QUARANTINE (received, awaiting QC), INV (LOT-traceable /
 * usable), WIP (work-in-progress). Received goods land in QUARANTINE; QC approval
 * transfers QUARANTINE -> INV.
 */
export const STOCK_STATUSES = ["INV", "WIP", "QUARANTINE"] as const;
export const stockStatusSchema = z.enum(STOCK_STATUSES);
export type StockStatus = (typeof STOCK_STATUSES)[number];

/**
 * Statuses whose quantity is tracked by physical location. INV (usable) and
 * QUARANTINE (received, on the dock) sit in real warehouse locations; WIP is
 * material on the production floor / in the vat and is not bin-located.
 */
export const LOCATED_STOCK_STATUSES = ["INV", "QUARANTINE"] as const;
export const locatedStockStatusSchema = z.enum(LOCATED_STOCK_STATUSES);
export type LocatedStockStatus = (typeof LOCATED_STOCK_STATUSES)[number];

/**
 * Stock ledger contracts. Every quantity change is an InventoryTxn; an item's
 * position is the running balance carried on the latest line. Weighted-average
 * costing — see the API's stock-costing module.
 */

export const TXN_TYPES = [
  "RECEIPT",
  "CONSUME",
  "PRODUCTION_OUTPUT",
  "SHIPMENT",
  "ADJUSTMENT",
  "TRANSFER",
  "SCRAP",
  "RETURN",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const DOC_TYPES = [
  "PURCHASE_ORDER",
  "PRODUCTION_RUN",
  "SALES_ORDER",
  "ADJUSTMENT",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const inventoryTxnSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  type: z.enum(TXN_TYPES),
  status: stockStatusSchema,
  /** Signed: positive = into stock, negative = out of stock. */
  quantity: z.string(),
  unitCost: z.string(),
  value: z.string(),
  balanceQty: z.string(),
  balanceAvgCost: z.string(),
  docType: z.enum(DOC_TYPES).nullable(),
  docId: z.string().nullable(),
  note: z.string().nullable(),
  /** Who posted this line (audit on the ledger); null for legacy/system rows. */
  createdById: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  /** The lot this quantity pertains to (traceability); null where no single lot applies. */
  lotId: z.string().uuid().nullable(),
  lotNumber: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

/** Current position of an item, derived from the ledger. */
export const inventoryPositionSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  unitOfMeasure: unitOfMeasureSchema,
  quantityOnHand: z.string(),
  avgCost: z.string(),
  totalValue: z.string(),
});

/** Manual stock adjustment (opening balances, counts, corrections). */
export const adjustStockSchema = z
  .object({
    direction: z.enum(["IN", "OUT"]),
    quantity: quantityString,
    /** Required for an inbound adjustment; outbound costs out at current average. */
    unitCost: moneyString.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.direction === "OUT" || d.unitCost !== undefined, {
    message: "unitCost is required for an inbound adjustment",
    path: ["unitCost"],
  });

/** Position of an item in a single status — for the WIP-vs-traceable report. */
export const stockPositionSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  itemType: itemTypeSchema,
  status: stockStatusSchema,
  quantity: z.string(),
  avgCost: z.string(),
  totalValue: z.string(),
});

/**
 * Scrap: write inventory off as a loss from any stage (INV, WIP, QUARANTINE).
 * Costs out at the bucket's average cost and is recorded as a SCRAP transaction
 * plus a ScrapRecord (with reason) for write-off reporting.
 */
export const SCRAP_REASONS = [
  "DAMAGED",
  "EXPIRED",
  "CONTAMINATED",
  "SPILL",
  "QC_FAILED",
  "OTHER",
] as const;
export const scrapReasonSchema = z.enum(SCRAP_REASONS);
export type ScrapReason = (typeof SCRAP_REASONS)[number];

export const scrapStockSchema = z.object({
  /** Which stage to scrap from: INV (usable), WIP, or QUARANTINE. */
  status: stockStatusSchema,
  quantity: quantityString.refine((v) => Number(v) > 0, "must be greater than 0"),
  /** Located stock (INV/QUARANTINE): which location to pull from. */
  locationId: z.string().uuid().optional(),
  reason: scrapReasonSchema,
  note: z.string().trim().max(500).optional(),
});

export const scrapRecordSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  status: stockStatusSchema,
  locationId: z.string().uuid().nullable(),
  locationCode: z.string().nullable(),
  locationName: z.string().nullable(),
  quantity: z.string(),
  /** The written-off value (loss) at the bucket's average cost. */
  value: z.string(),
  reason: scrapReasonSchema,
  note: z.string().nullable(),
  operatorId: z.string().uuid(),
  operatorName: z.string(),
  occurredAt: z.string().datetime(),
});

export type InventoryTxn = z.infer<typeof inventoryTxnSchema>;
export type InventoryPosition = z.infer<typeof inventoryPositionSchema>;
export type AdjustStock = z.infer<typeof adjustStockSchema>;
export type StockPosition = z.infer<typeof stockPositionSchema>;
export type ScrapStock = z.infer<typeof scrapStockSchema>;
export type ScrapRecord = z.infer<typeof scrapRecordSchema>;

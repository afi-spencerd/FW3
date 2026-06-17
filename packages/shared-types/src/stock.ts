import { z } from "zod";
import { moneyString, quantityString } from "./money.js";
import { itemTypeSchema, unitOfMeasureSchema } from "./inventory.js";

/** Inventory state: LOT-traceable (INV) vs work-in-progress (WIP). */
export const STOCK_STATES = ["INV", "WIP"] as const;
export const stockStateSchema = z.enum(STOCK_STATES);
export type StockState = (typeof STOCK_STATES)[number];

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
  state: stockStateSchema,
  /** Signed: positive = into stock, negative = out of stock. */
  quantity: z.string(),
  unitCost: z.string(),
  value: z.string(),
  balanceQty: z.string(),
  balanceAvgCost: z.string(),
  docType: z.enum(DOC_TYPES).nullable(),
  docId: z.string().nullable(),
  note: z.string().nullable(),
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

/** Position of an item in a single state — for the WIP-vs-traceable report. */
export const stockPositionSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  itemType: itemTypeSchema,
  state: stockStateSchema,
  quantity: z.string(),
  avgCost: z.string(),
  totalValue: z.string(),
});

export type InventoryTxn = z.infer<typeof inventoryTxnSchema>;
export type InventoryPosition = z.infer<typeof inventoryPositionSchema>;
export type AdjustStock = z.infer<typeof adjustStockSchema>;
export type StockPosition = z.infer<typeof stockPositionSchema>;

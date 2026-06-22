import { z } from "zod";
import { moneyString, quantityString } from "./money.js";
import { scrapReasonSchema } from "./stock.js";

/**
 * Container (packaging) inventory: the drums, cans, jugs, bottles, etc. that
 * finished fragrance is packed into before shipment. Tracked like inventory —
 * counted in whole units ("each"), with a weighted-average cost so scrap and
 * consumption post a value — but kept separate from the pounds-canonical
 * fragrance inventory. Containers are consumed when an order is packed.
 */

export const CONTAINER_TYPES = [
  "DRUM",
  "PAIL",
  "JUG",
  "CAN",
  "BOTTLE",
  "TOTE",
  "OTHER",
] as const;
export const containerTypeSchema = z.enum(CONTAINER_TYPES);
export type ContainerType = (typeof CONTAINER_TYPES)[number];

/** A count of whole containers — positive, integer. */
const containerCount = z
  .string()
  .regex(/^\d{1,9}$/, "must be a whole number of containers")
  .refine((v) => Number(v) > 0, "must be greater than 0");

export const createContainerSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  containerType: containerTypeSchema,
  /**
   * Nominal fill capacity in pounds — used to default how many containers an
   * order needs (ceil(orderLb / capacity)). Optional; omit if not applicable.
   */
  capacityLb: quantityString.optional(),
  /** Standard/purchase cost per container (the moving average lives in the ledger). */
  standardCost: moneyString.default("0"),
  active: z.boolean().default(true),
  /**
   * Optional opening stock — quantity already on hand that never came through a
   * PO. When set, the container is created and an opening IN adjustment is posted
   * in one step (unit cost defaults to standardCost).
   */
  openingQuantity: containerCount.optional(),
  openingUnitCost: moneyString.optional(),
});

export const updateContainerSchema = createContainerSchema
  .omit({ sku: true, openingQuantity: true, openingUnitCost: true })
  .partial();

export const containerSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  containerType: containerTypeSchema,
  capacityLb: z.string().nullable(),
  standardCost: z.string(),
  active: z.boolean(),
  // Position (from the ledger): on-hand count, moving-average cost, value.
  quantityOnHand: z.string(),
  avgCost: z.string(),
  totalValue: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Receive (IN) or correct (OUT) container stock; IN re-averages cost. */
export const adjustContainerSchema = z.object({
  direction: z.enum(["IN", "OUT"]),
  quantity: containerCount,
  /** Required for IN (purchase/opening cost); ignored for OUT. */
  unitCost: moneyString.optional(),
  note: z.string().trim().max(500).optional(),
});

/** Write off damaged containers from stock (loss at average cost). */
export const scrapContainerSchema = z.object({
  quantity: containerCount,
  reason: scrapReasonSchema,
  note: z.string().trim().max(500).optional(),
});

export const CONTAINER_TXN_TYPES = ["ADJUSTMENT", "CONSUME", "SCRAP"] as const;
export const containerTxnTypeSchema = z.enum(CONTAINER_TXN_TYPES);
export type ContainerTxnType = (typeof CONTAINER_TXN_TYPES)[number];

export const containerTxnSchema = z.object({
  id: z.string().uuid(),
  containerId: z.string().uuid(),
  type: containerTxnTypeSchema,
  /** Signed: positive in, negative out. */
  quantity: z.string(),
  unitCost: z.string(),
  value: z.string(),
  balanceQty: z.string(),
  reason: scrapReasonSchema.nullable(),
  note: z.string().nullable(),
  docType: z.string().nullable(),
  docId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

/**
 * Containers needed to pack a given weight, by capacity (whole containers,
 * rounded up). Returns 0 when capacity is unknown so the UI can prompt a manual
 * count. Pure helper shared by the form (default) and any server-side checks.
 */
export function containersForWeight(
  poundsQty: string,
  capacityLb: string | null,
): number {
  const cap = Number(capacityLb ?? "0");
  const lb = Number(poundsQty ?? "0");
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(lb) || lb <= 0) {
    return 0;
  }
  return Math.ceil(lb / cap);
}

export type CreateContainer = z.infer<typeof createContainerSchema>;
export type UpdateContainer = z.infer<typeof updateContainerSchema>;
export type Container = z.infer<typeof containerSchema>;
export type AdjustContainer = z.infer<typeof adjustContainerSchema>;
export type ScrapContainer = z.infer<typeof scrapContainerSchema>;
export type ContainerTxn = z.infer<typeof containerTxnSchema>;

import { z } from "zod";
import { quantityString } from "./money.js";
import { locatedStockStatusSchema } from "./stock.js";

/**
 * Cycle counts: verify physical inventory at locations against the system and
 * post the variances as adjustments. Scope is one of: a location (a rack/area, or
 * a building/aisle that expands to its leaves), a single item across all locations,
 * or the whole tenant. Only located stock (INV, QUARANTINE) is counted; WIP
 * (cans/vat) is not location-counted.
 */

export const CYCLE_COUNT_STATUSES = ["OPEN", "COMPLETED", "CANCELLED"] as const;
export const cycleCountStatusSchema = z.enum(CYCLE_COUNT_STATUSES);
export type CycleCountStatus = (typeof CYCLE_COUNT_STATUSES)[number];

const countQuantity = quantityString.refine(
  (v) => Number(v) >= 0,
  "must be zero or greater",
);

/**
 * Open a new count. Scope is at most one of scopeLocationId or scopeItemId;
 * omit both to count every location.
 */
export const createCycleCountSchema = z
  .object({
    scopeLocationId: z.string().uuid().optional(),
    /** Count this one item across every location it sits in. */
    scopeItemId: z.string().uuid().optional(),
    /** Hide system quantities from the counter until the count is posted. */
    blind: z.boolean().default(false),
    note: z.string().trim().max(500).optional(),
    /** Optional human reference; auto-generated when omitted. */
    reference: z.string().trim().max(50).optional(),
  })
  .refine((d) => !(d.scopeLocationId && d.scopeItemId), {
    message: "A count is scoped by location or by item, not both",
    path: ["scopeItemId"],
  });

/** Enter counted quantities for existing lines, and add any items found. */
export const recordCycleCountsSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        countedQty: countQuantity,
      }),
    )
    .default([]),
  /** Items physically present that weren't on the snapshot (system shows 0). */
  found: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        status: locatedStockStatusSchema.default("INV"),
        locationId: z.string().uuid(),
        countedQty: countQuantity,
      }),
    )
    .default([]),
});

export const cycleCountLineSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  status: locatedStockStatusSchema,
  locationId: z.string().uuid(),
  locationCode: z.string(),
  locationName: z.string(),
  /** System quantity at snapshot (lb). Null while a blind count is still open. */
  expectedQty: z.string().nullable(),
  countedQty: z.string().nullable(),
  counted: z.boolean(),
  /** countedQty − expectedQty (lb). Null until counted / while blind+open. */
  variance: z.string().nullable(),
});

export const cycleCountSummarySchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  status: cycleCountStatusSchema,
  blind: z.boolean(),
  scopeLocationId: z.string().uuid().nullable(),
  scopeItemId: z.string().uuid().nullable(),
  scopeLabel: z.string(),
  note: z.string().nullable(),
  lineCount: z.number().int(),
  countedCount: z.number().int(),
  varianceCount: z.number().int(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const cycleCountSchema = cycleCountSummarySchema.extend({
  lines: z.array(cycleCountLineSchema),
});

export type CreateCycleCount = z.infer<typeof createCycleCountSchema>;
export type RecordCycleCounts = z.infer<typeof recordCycleCountsSchema>;
export type CycleCountLine = z.infer<typeof cycleCountLineSchema>;
export type CycleCountSummary = z.infer<typeof cycleCountSummarySchema>;
export type CycleCount = z.infer<typeof cycleCountSchema>;

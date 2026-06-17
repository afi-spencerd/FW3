import { z } from "zod";

/**
 * Quality control for received material. Each received supplier lot lands in
 * QUARANTINE and gets an acceptance test suite; results are checked against the
 * item's per-test spec, and the lot is approved (-> usable) or rejected.
 */

export const QC_TEST_TYPES = [
  "SPECIFIC_GRAVITY",
  "REFRACTIVE_INDEX",
  "COLOR",
  "ODOR",
] as const;
export type QcTestType = (typeof QC_TEST_TYPES)[number];

/** NUMERIC tests check a min/max range; DESCRIPTIVE tests match an expected value. */
export const QC_TEST_KIND = {
  SPECIFIC_GRAVITY: "NUMERIC",
  REFRACTIVE_INDEX: "NUMERIC",
  COLOR: "DESCRIPTIVE",
  ODOR: "DESCRIPTIVE",
} as const satisfies Record<QcTestType, "NUMERIC" | "DESCRIPTIVE">;

export const QC_LOT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type QcLotStatus = (typeof QC_LOT_STATUSES)[number];

/** Where a lot came from: a vendor receipt, or an in-house production work order. */
export const LOT_ORIGINS = ["RECEIPT", "PRODUCTION"] as const;
export type LotOrigin = (typeof LOT_ORIGINS)[number];

// ---- Per-item acceptance spec ----
export const qualitySpecInputSchema = z.object({
  testType: z.enum(QC_TEST_TYPES),
  minValue: z.string().trim().max(40).optional(),
  maxValue: z.string().trim().max(40).optional(),
  expectedValue: z.string().trim().max(200).optional(),
});
export const setItemQualitySpecsSchema = z.object({
  specs: z.array(qualitySpecInputSchema),
});

export const itemQualitySpecSchema = z.object({
  testType: z.enum(QC_TEST_TYPES),
  kind: z.enum(["NUMERIC", "DESCRIPTIVE"]),
  minValue: z.string().nullable(),
  maxValue: z.string().nullable(),
  expectedValue: z.string().nullable(),
});

// ---- Test results ----
export const qualityResultInputSchema = z.object({
  testType: z.enum(QC_TEST_TYPES),
  measuredValue: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(500).optional(),
  /** Optional manual override of the computed pass/fail (e.g. descriptive judgment). */
  passed: z.boolean().optional(),
});
export const recordQualityResultsSchema = z.object({
  results: z.array(qualityResultInputSchema).min(1),
});

export const qualityResultSchema = z.object({
  testType: z.enum(QC_TEST_TYPES),
  kind: z.enum(["NUMERIC", "DESCRIPTIVE"]),
  measuredValue: z.string().nullable(),
  passed: z.boolean().nullable(),
  notes: z.string().nullable(),
});

// ---- Lot (received or produced) ----
export const lotSchema = z.object({
  id: z.string().uuid(),
  origin: z.enum(LOT_ORIGINS),
  itemId: z.string().uuid(),
  itemSku: z.string(),
  itemName: z.string(),
  vendorName: z.string().nullable(),
  purchaseOrderNumber: z.string().nullable(),
  workOrderNumber: z.string().nullable(),
  lotNumber: z.string(),
  quantity: z.string(),
  /** Quantity already packed off (production lots) — quantity - packedQty remains in WIP. */
  packedQty: z.string(),
  unitCost: z.string(),
  qcStatus: z.enum(QC_LOT_STATUSES),
  receivedAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  rejectionReason: z.string().nullable(),
  results: z.array(qualityResultSchema),
});

export const lotSummarySchema = lotSchema
  .omit({ results: true })
  .extend({ testCount: z.number().int(), passCount: z.number().int() });

export const rejectLotSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type QualitySpecInput = z.infer<typeof qualitySpecInputSchema>;
export type SetItemQualitySpecs = z.infer<typeof setItemQualitySpecsSchema>;
export type ItemQualitySpec = z.infer<typeof itemQualitySpecSchema>;
export type QualityResultInput = z.infer<typeof qualityResultInputSchema>;
export type RecordQualityResults = z.infer<typeof recordQualityResultsSchema>;
export type QualityResult = z.infer<typeof qualityResultSchema>;
export type Lot = z.infer<typeof lotSchema>;
export type LotSummary = z.infer<typeof lotSummarySchema>;
export type RejectLot = z.infer<typeof rejectLotSchema>;

import { z } from "zod";
import { quantityString } from "./money.js";
import { unitOfMeasureSchema } from "./inventory.js";

/**
 * Fragrance formula contracts. A formula defines a finished good (fragrance) as
 * a composition of raw materials **by percentage of weight**; the line
 * percentages must sum to exactly 100. A batch size then scales the percentages
 * into absolute per-material quantities.
 */

const PERCENT_RE = /^\d{1,3}(\.\d{1,4})?$/;

/** Scale a percentage string to an integer of ten-thousandths (exact, no float). */
function percentTo10000ths(value: string): bigint {
  const [int, frac = ""] = value.split(".");
  const fracPadded = (frac + "0000").slice(0, 4);
  return BigInt(int || "0") * 10000n + BigInt(fracPadded || "0");
}

/** True when the percentages sum to exactly 100.0000 (integer-exact). */
export function percentagesSumTo100(values: string[]): boolean {
  return values.reduce((sum, v) => sum + percentTo10000ths(v), 0n) === 1_000_000n;
}

/** A line percentage: decimal string, 0 < p <= 100. */
export const percentageString = z
  .string()
  .regex(PERCENT_RE, "must be a percentage with up to 4 decimals")
  .refine((v) => {
    const scaled = percentTo10000ths(v);
    return scaled > 0n && scaled <= 1_000_000n;
  }, "must be greater than 0 and at most 100");

export const formulaLineInputSchema = z.object({
  rawMaterialId: z.string().uuid(),
  percentage: percentageString,
  sortOrder: z.number().int().min(0).default(0),
});

const sumsTo100 = (lines: { percentage: string }[]) =>
  percentagesSumTo100(lines.map((l) => l.percentage));
const noDuplicateMaterials = (lines: { rawMaterialId: string }[]) =>
  new Set(lines.map((l) => l.rawMaterialId)).size === lines.length;

/**
 * A target may be created inline with the formula instead of selecting an
 * existing item — only manufactured tiers (finished good or base) are valid,
 * and the item defaults to pounds; price / accounts / regulatory data are filled
 * in later on the item page.
 */
export const formulaNewTargetSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  itemType: z.enum(["FINISHED_GOOD", "SEMI_FINISHED"]),
});

const formulaCreateObject = z.object({
  /** Existing target item; mutually exclusive with newTarget. */
  finishedGoodId: z.string().uuid().optional(),
  /** Create the target item inline; mutually exclusive with finishedGoodId. */
  newTarget: formulaNewTargetSchema.optional(),
  name: z.string().trim().min(1).max(200),
  /** Omit to auto-assign the next available version for the target. */
  version: z.number().int().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
  lines: z.array(formulaLineInputSchema).min(1),
});

const formulaUpdateObject = formulaCreateObject.omit({
  finishedGoodId: true,
  newTarget: true,
});

const exactlyOneTarget = (v: { finishedGoodId?: string; newTarget?: unknown }) =>
  (v.finishedGoodId ? 1 : 0) + (v.newTarget ? 1 : 0) === 1;

export const createFormulaSchema = formulaCreateObject
  .refine(exactlyOneTarget, {
    message: "select an existing target or define a new one (exactly one)",
    path: ["finishedGoodId"],
  })
  .refine(({ lines }) => sumsTo100(lines), {
    message: "line percentages must sum to exactly 100",
    path: ["lines"],
  })
  .refine(({ lines }) => noDuplicateMaterials(lines), {
    message: "a raw material may only appear once in a formula",
    path: ["lines"],
  });

export const updateFormulaSchema = formulaUpdateObject
  .refine(({ lines }) => sumsTo100(lines), {
    message: "line percentages must sum to exactly 100",
    path: ["lines"],
  })
  .refine(({ lines }) => noDuplicateMaterials(lines), {
    message: "a raw material may only appear once in a formula",
    path: ["lines"],
  });

/** Read shapes. */
export const formulaLineSchema = z.object({
  id: z.string().uuid(),
  rawMaterialId: z.string().uuid(),
  rawMaterialSku: z.string(),
  rawMaterialName: z.string(),
  percentage: z.string(),
  sortOrder: z.number().int(),
});

export const formulaSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  finishedGoodId: z.string().uuid(),
  finishedGoodSku: z.string(),
  finishedGoodName: z.string(),
  name: z.string(),
  version: z.number().int(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  lines: z.array(formulaLineSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const formulaSummarySchema = formulaSchema.omit({ lines: true }).extend({
  lineCount: z.number().int(),
});

/** Batch requirements: scale a formula to an absolute batch size. Pounds only. */
export const batchRequirementsRequestSchema = z.object({
  batchSize: quantityString,
  unit: z.literal("LB").default("LB"),
});

export const batchRequirementLineSchema = z.object({
  rawMaterialId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  percentage: z.string(),
  /** Required amount in pounds (the canonical batching unit). */
  requiredQuantity: z.string(),
  /** The material's handling unit, so KG materials can show a kg equivalent. */
  handlingUnit: unitOfMeasureSchema,
});

export const batchRequirementsSchema = z.object({
  formulaId: z.string().uuid(),
  batchSize: z.string(),
  unit: z.literal("LB"),
  lines: z.array(batchRequirementLineSchema),
});

export type FormulaLineInput = z.infer<typeof formulaLineInputSchema>;
export type FormulaNewTarget = z.infer<typeof formulaNewTargetSchema>;
export type CreateFormula = z.infer<typeof createFormulaSchema>;
export type UpdateFormula = z.infer<typeof updateFormulaSchema>;
export type FormulaLine = z.infer<typeof formulaLineSchema>;
export type Formula = z.infer<typeof formulaSchema>;
export type FormulaSummary = z.infer<typeof formulaSummarySchema>;
export type BatchRequirementsRequest = z.infer<typeof batchRequirementsRequestSchema>;
export type BatchRequirementLine = z.infer<typeof batchRequirementLineSchema>;
export type BatchRequirements = z.infer<typeof batchRequirementsSchema>;

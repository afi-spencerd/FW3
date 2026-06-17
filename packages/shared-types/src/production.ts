import { z } from "zod";
import { quantityString } from "./money.js";
import { unitOfMeasureSchema } from "./inventory.js";

/** Production runs: make a target (finished good or base) from a formula. */

export const PRODUCTION_STATUSES = [
  "PLANNED",
  "STAGED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

const positiveQty = quantityString.refine(
  (v) => Number(v) > 0,
  "must be greater than 0",
);

export const createProductionRunSchema = z.object({
  runNumber: z.string().trim().min(1).max(50),
  targetItemId: z.string().uuid(),
  formulaId: z.string().uuid(),
  batchSize: positiveQty,
  batchUnit: unitOfMeasureSchema,
  outputQty: positiveQty,
  notes: z.string().trim().max(2000).optional(),
});

export const productionRunLineSchema = z.object({
  id: z.string().uuid(),
  componentId: z.string().uuid(),
  componentSku: z.string(),
  componentName: z.string(),
  stockingUnit: unitOfMeasureSchema,
  requiredQty: z.string(),
  stagedQty: z.string(),
  consumedQty: z.string(),
  sortOrder: z.number().int(),
});

export const productionRunSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  runNumber: z.string(),
  targetItemId: z.string().uuid(),
  targetSku: z.string(),
  targetName: z.string(),
  formulaId: z.string().uuid(),
  formulaName: z.string(),
  batchSize: z.string(),
  batchUnit: unitOfMeasureSchema,
  outputQty: z.string(),
  status: z.enum(PRODUCTION_STATUSES),
  notes: z.string().nullable(),
  lines: z.array(productionRunLineSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const productionRunSummarySchema = productionRunSchema
  .omit({ lines: true })
  .extend({ lineCount: z.number().int() });

/** Pack-off: move a quantity of a finished good/base from FG_WIP to FG_INV. */
export const packOffSchema = z.object({ quantity: positiveQty });

export type CreateProductionRun = z.infer<typeof createProductionRunSchema>;
export type ProductionRunLine = z.infer<typeof productionRunLineSchema>;
export type ProductionRun = z.infer<typeof productionRunSchema>;
export type ProductionRunSummary = z.infer<typeof productionRunSummarySchema>;
export type PackOff = z.infer<typeof packOffSchema>;

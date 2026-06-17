import { z } from "zod";
import { quantityString } from "./money.js";
import { unitOfMeasureSchema } from "./inventory.js";

/**
 * Production work orders: an instruction to make a target (finished good or
 * base) from a formula. "Work order" is the shop-floor vernacular.
 */

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

export const createProductionWorkOrderSchema = z.object({
  workOrderNumber: z.string().trim().min(1).max(50),
  targetItemId: z.string().uuid(),
  formulaId: z.string().uuid(),
  batchSize: positiveQty,
  batchUnit: unitOfMeasureSchema,
  outputQty: positiveQty,
  notes: z.string().trim().max(2000).optional(),
});

export const productionWorkOrderLineSchema = z.object({
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

export const productionWorkOrderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  workOrderNumber: z.string(),
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
  lines: z.array(productionWorkOrderLineSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const productionWorkOrderSummarySchema = productionWorkOrderSchema
  .omit({ lines: true })
  .extend({ lineCount: z.number().int() });

/** Pack-off: move a quantity of a finished good/base from FG_WIP to FG_INV. */
export const packOffSchema = z.object({ quantity: positiveQty });

export type CreateProductionWorkOrder = z.infer<
  typeof createProductionWorkOrderSchema
>;
export type ProductionWorkOrderLine = z.infer<
  typeof productionWorkOrderLineSchema
>;
export type ProductionWorkOrder = z.infer<typeof productionWorkOrderSchema>;
export type ProductionWorkOrderSummary = z.infer<
  typeof productionWorkOrderSummarySchema
>;
export type PackOff = z.infer<typeof packOffSchema>;

import { z } from "zod";
import { itemTypeSchema, unitOfMeasureSchema } from "./inventory.js";
import { quantityString } from "./money.js";
import {
  COMPOUNDER_SETTABLE_STATUSES,
  PRODUCTION_STATUSES,
} from "./production.js";

/**
 * Contracts for the compounder dosing-tool integration. The tool reads the
 * work-order queue, each order's bill of materials, and available inventory,
 * then reports pours (which consume from WIP), work-order status, and — via the
 * authenticated session — the operator who performed each pour.
 */

const pourQuantity = quantityString.refine(
  (v) => Number(v) > 0,
  "must be greater than 0",
);

/** The signed-in user the tool is acting as — the operator of record. */
export const compounderOperatorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
});

/** Available inventory snapshot for an item (canonical pounds). */
export const compounderInventoryRowSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  itemType: itemTypeSchema,
  handlingUnit: unitOfMeasureSchema,
  /** Usable (LOT-traceable) on hand, in pounds. */
  invQuantity: z.string(),
  /** Work-in-progress (staged in cans / in the vat), in pounds. */
  wipQuantity: z.string(),
});

/** One BOM line on a work order, with progress + what's available to pour. */
export const compounderWorkOrderLineSchema = z.object({
  lineId: z.string().uuid(),
  componentId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  handlingUnit: unitOfMeasureSchema,
  /** Formula percentage of the batch by weight. */
  percentage: z.string(),
  /** Target amount for this batch, in pounds. */
  requiredQty: z.string(),
  /** Amount staged into WIP, in pounds. */
  stagedQty: z.string(),
  /** Amount poured/consumed so far, in pounds. */
  consumedQty: z.string(),
  /** Currently available to pour from WIP, in pounds. */
  wipAvailable: z.string(),
});

export const compounderWorkOrderSummarySchema = z.object({
  id: z.string().uuid(),
  workOrderNumber: z.string(),
  status: z.enum(PRODUCTION_STATUSES),
  targetItemId: z.string().uuid(),
  targetSku: z.string(),
  targetName: z.string(),
  formulaName: z.string(),
  batchSize: z.string(),
  outputQty: z.string(),
  lineCount: z.number().int(),
});

export const compounderWorkOrderSchema = compounderWorkOrderSummarySchema.extend({
  lines: z.array(compounderWorkOrderLineSchema),
});

/** Report a pour: dose `quantity` (lb) of `componentId` into the batch. */
export const compounderPourInputSchema = z.object({
  componentId: z.string().uuid(),
  quantity: pourQuantity,
  note: z.string().trim().max(500).optional(),
});

export const compounderPourSchema = z.object({
  id: z.string().uuid(),
  workOrderId: z.string().uuid(),
  workOrderLineId: z.string().uuid(),
  componentId: z.string().uuid(),
  componentSku: z.string(),
  componentName: z.string(),
  quantity: z.string(),
  operator: compounderOperatorSchema,
  note: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

/** Set a work order's status (start, pause, or finish the batch). */
export const compounderStatusUpdateSchema = z.object({
  status: z.enum(COMPOUNDER_SETTABLE_STATUSES),
});

export type CompounderOperator = z.infer<typeof compounderOperatorSchema>;
export type CompounderInventoryRow = z.infer<typeof compounderInventoryRowSchema>;
export type CompounderWorkOrderLine = z.infer<typeof compounderWorkOrderLineSchema>;
export type CompounderWorkOrderSummary = z.infer<typeof compounderWorkOrderSummarySchema>;
export type CompounderWorkOrder = z.infer<typeof compounderWorkOrderSchema>;
export type CompounderPourInput = z.infer<typeof compounderPourInputSchema>;
export type CompounderPour = z.infer<typeof compounderPourSchema>;
export type CompounderStatusUpdate = z.infer<typeof compounderStatusUpdateSchema>;

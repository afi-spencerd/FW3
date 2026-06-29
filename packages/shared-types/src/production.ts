import { z } from "zod";
import { quantityString } from "./money.js";
import { unitOfMeasureSchema } from "./inventory.js";

/**
 * Production work orders: an instruction to make a target (finished good or
 * base) from a formula. "Work order" is the shop-floor vernacular.
 */

export const PRODUCTION_STATUSES = [
  // Scheduler lifecycle, ahead of the floor pipeline:
  //   REQUESTED — created from a sales order, awaiting scheduling
  //   QUEUED    — sequenced in the run queue (has a queuePosition)
  // Releasing a queued order drops it into PLANNED (the existing ready-for-floor
  // state) without moving any material — staging is still the floor's action.
  "REQUESTED",
  "QUEUED",
  "PLANNED",
  "STAGED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

/**
 * Statuses the compounder dosing tool may set on a staged work order:
 * start pouring (IN_PROGRESS), pause (ON_HOLD), or finish the batch (COMPLETED,
 * which outputs the FG and opens its QC lot).
 */
export const COMPOUNDER_SETTABLE_STATUSES = [
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
] as const;
export type CompounderSettableStatus =
  (typeof COMPOUNDER_SETTABLE_STATUSES)[number];

const positiveQty = quantityString.refine(
  (v) => Number(v) > 0,
  "must be greater than 0",
);

// ---- Pour routing ----
/**
 * Where a pour (one work-order component) is dispatched. LAB is the 2 lb
 * "small pours" lab (the LAB operator role); ROBOT is the automated station.
 */
export const POUR_LOCATIONS = ["FLOOR", "LAB", "ROBOT"] as const;
export const pourLocationSchema = z.enum(POUR_LOCATIONS);
export type PourLocation = (typeof POUR_LOCATIONS)[number];

export const POUR_LOCATION_LABELS: Record<PourLocation, string> = {
  FLOOR: "Floor",
  LAB: "2lb (small pours) lab",
  ROBOT: "Robot",
};

/**
 * Decide where a single pour is initially assigned. Pure so it can be shared and
 * unit-tested. Quantities and thresholds are in canonical pounds.
 * - Floor-restricted materials (resins, heat-before-add, add-last, reaction-prone)
 *   always go to the floor.
 * - Pours over the small-pours-lab threshold always go to the floor.
 * - A small pour of a material currently loaded in the (running) robot, below the
 *   robot threshold, goes to the robot.
 * - Otherwise a small pour goes to the 2 lb small-pours lab.
 */
export function assignPourLocation(args: {
  restrictToFloor: boolean;
  quantityLb: number;
  inRobot: boolean;
  robotDown: boolean;
  smallPoursLabThresholdLb: number;
  robotPourThresholdLb: number;
}): PourLocation {
  if (args.restrictToFloor) return "FLOOR";
  if (args.quantityLb > args.smallPoursLabThresholdLb) return "FLOOR";
  if (args.inRobot && !args.robotDown && args.quantityLb < args.robotPourThresholdLb) {
    return "ROBOT";
  }
  return "LAB";
}

export const createProductionWorkOrderSchema = z.object({
  workOrderNumber: z.string().trim().min(1).max(50),
  targetItemId: z.string().uuid(),
  formulaId: z.string().uuid(),
  batchSize: positiveQty,
  // Batching is always in pounds (the canonical unit).
  batchUnit: z.literal("LB").default("LB"),
  outputQty: positiveQty,
  notes: z.string().trim().max(2000).optional(),
});

export const productionWorkOrderLineSchema = z.object({
  id: z.string().uuid(),
  componentId: z.string().uuid(),
  componentSku: z.string(),
  componentName: z.string(),
  /** The component's handling unit, so KG materials can show a kg equivalent. */
  handlingUnit: unitOfMeasureSchema,
  /** Required amount in pounds (canonical). */
  requiredQty: z.string(),
  stagedQty: z.string(),
  consumedQty: z.string(),
  /** Usable on-hand (INV) for this component, in pounds. Populated on the detail view. */
  invAvailable: z.string().optional(),
  /** WIP available to pour for this component, in pounds. Populated on the detail view. */
  wipAvailable: z.string().optional(),
  sortOrder: z.number().int(),
  /** Where this pour is assigned (null for legacy lines created before routing). */
  assignedLocation: pourLocationSchema.nullable(),
});

/** Manually override (by scheduling) where a work-order line's pour is assigned. */
export const setPourLocationSchema = z.object({ location: pourLocationSchema });

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
  /** Position in the scheduler run queue (QUEUED only); null otherwise. */
  queuePosition: z.number().int().nullable(),
  /** The sales order this batch fulfils (null for ad-hoc work orders). */
  salesOrderId: z.string().uuid().nullable(),
  soNumber: z.string().nullable(),
  lines: z.array(productionWorkOrderLineSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const productionWorkOrderSummarySchema = productionWorkOrderSchema
  .omit({ lines: true })
  .extend({ lineCount: z.number().int() });

/** Pack-off: move a quantity of a finished good/base from FG_WIP to FG_INV. */
export const packOffSchema = z.object({ quantity: positiveQty });

// ---- Scheduler ----
/** Availability of one component (raw material) for a work order, in pounds. */
export const schedulerMaterialSchema = z.object({
  componentId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  requiredQty: z.string(),
  availableQty: z.string(),
  short: z.boolean(),
});

/** Availability of the order's packing container (if any), counted each. */
export const schedulerContainerSchema = z.object({
  containerId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  requiredQty: z.string(),
  availableQty: z.string(),
  short: z.boolean(),
});

/**
 * Feasibility of a work order: materials + container are advisory flags (not a
 * hard gate — the material check is enforced at staging). Manpower is advisory.
 */
export const schedulerFeasibilitySchema = z.object({
  /** True if any material or the container is short — surfaced as a flag. */
  blocked: z.boolean(),
  materials: z.array(schedulerMaterialSchema),
  container: schedulerContainerSchema.nullable(),
  manpower: z.object({
    poursNeeded: z.number().int(),
    dailyCapacity: z.number().int(),
    withinCapacity: z.boolean(),
  }),
});

/** A work order as seen on the scheduler board (REQUESTED or QUEUED). */
export const schedulerWorkOrderSchema = z.object({
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
  salesOrderId: z.string().uuid().nullable(),
  soNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  customerRating: z.enum(["A", "B", "C", "D"]).nullable(),
  requestedShipDate: z.string().datetime().nullable(),
  /** Ship date is inside 72h. */
  isRush: z.boolean(),
  /** Position in the run queue (QUEUED only); null while REQUESTED. */
  queuePosition: z.number().int().nullable(),
  /** Where this REQUESTED order would land if queued by the rules (advisory). */
  suggestedPosition: z.number().int().nullable(),
  feasibility: schedulerFeasibilitySchema,
});

export const schedulerBoardSchema = z.object({
  requested: z.array(schedulerWorkOrderSchema),
  queued: z.array(schedulerWorkOrderSchema),
});

/** Move a requested order into the queue (defaults to its suggested slot). */
export const enqueueWorkOrderSchema = z.object({
  position: z.number().int().min(0).optional(),
});

/** Move a selected subset of requested orders into the queue, sorted by rules. */
export const queueByRulesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

/** Reorder a queued order to an explicit position. */
export const repositionWorkOrderSchema = z.object({
  position: z.number().int().min(0),
});

/**
 * Reassign (re-reserve) a work order to a different sales order. The optional
 * line pins the batch to a specific order line; omit it to attach to the order
 * only. Moving a work order leaves its original sales order line uncovered, so
 * that line can be re-requested for a fresh batch.
 */
export const reassignWorkOrderSchema = z.object({
  salesOrderId: z.string().uuid(),
  salesOrderLineId: z.string().uuid().optional(),
});

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
export type SchedulerMaterial = z.infer<typeof schedulerMaterialSchema>;
export type SchedulerContainer = z.infer<typeof schedulerContainerSchema>;
export type SchedulerFeasibility = z.infer<typeof schedulerFeasibilitySchema>;
export type SchedulerWorkOrder = z.infer<typeof schedulerWorkOrderSchema>;
export type SchedulerBoard = z.infer<typeof schedulerBoardSchema>;
export type EnqueueWorkOrder = z.infer<typeof enqueueWorkOrderSchema>;
export type QueueByRules = z.infer<typeof queueByRulesSchema>;
export type RepositionWorkOrder = z.infer<typeof repositionWorkOrderSchema>;
export type ReassignWorkOrder = z.infer<typeof reassignWorkOrderSchema>;
export type SetPourLocation = z.infer<typeof setPourLocationSchema>;

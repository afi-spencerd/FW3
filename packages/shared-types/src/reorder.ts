import { z } from "zod";
import { itemTypeSchema } from "./inventory.js";

/**
 * Reorder flags — items/containers whose usable on-hand has dropped below their
 * reorder point. Computed live from current stock (self-healing once restocked),
 * not persisted. Raw materials + containers flag Purchasing; produced goods
 * (finished goods + bases) flag Scheduling.
 */

export const reorderItemSchema = z.object({
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  itemType: itemTypeSchema,
  /** Usable (INV) quantity on hand. */
  onHand: z.string(),
  reorderPoint: z.string(),
});

export const reorderContainerSchema = z.object({
  containerId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  onHand: z.string(),
  reorderPoint: z.string(),
});

/** Purchasing's view: bought items (raw materials) and containers below reorder. */
export const purchasingReorderSchema = z.object({
  materials: z.array(reorderItemSchema),
  containers: z.array(reorderContainerSchema),
});

/** Scheduling's view: produced goods (finished goods + bases) below reorder. */
export const schedulerReorderSchema = z.object({
  items: z.array(reorderItemSchema),
});

export type ReorderItem = z.infer<typeof reorderItemSchema>;
export type ReorderContainer = z.infer<typeof reorderContainerSchema>;
export type PurchasingReorder = z.infer<typeof purchasingReorderSchema>;
export type SchedulerReorder = z.infer<typeof schedulerReorderSchema>;

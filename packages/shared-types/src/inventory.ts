import { z } from "zod";
import { moneyString, quantityString } from "./money.js";

/**
 * Inventory item contracts — shared by the API (DTO validation) and the web
 * client (form validation + typed responses). The API is the source of truth;
 * the browser only does UX-level validation against these same schemas.
 */

export const unitOfMeasure = z.string().trim().min(1).max(16);

/** Fields a user can submit when creating an item. */
export const createInventoryItemSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  unitOfMeasure: unitOfMeasure.default("EA"),
  quantityOnHand: quantityString.default("0"),
  unitCost: moneyString.default("0"),
  salesPrice: moneyString.default("0"),
  active: z.boolean().default(true),
});

/** All fields optional on update; sku is immutable so it is intentionally omitted. */
export const updateInventoryItemSchema = createInventoryItemSchema
  .omit({ sku: true })
  .partial();

/** Shape returned to clients. Money/qty are strings (see money.ts). */
export const inventoryItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unitOfMeasure: z.string(),
  quantityOnHand: z.string(),
  unitCost: z.string(),
  salesPrice: z.string(),
  /** quantityOnHand * unitCost, computed server-side. */
  extendedValue: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const inventoryListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  // Query strings: compare explicitly — z.coerce.boolean("false") would be true.
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const paginatedInventorySchema = z.object({
  items: z.array(inventoryItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type CreateInventoryItemInput = z.input<typeof createInventoryItemSchema>;
export type CreateInventoryItem = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItem = z.infer<typeof updateInventoryItemSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type PaginatedInventory = z.infer<typeof paginatedInventorySchema>;

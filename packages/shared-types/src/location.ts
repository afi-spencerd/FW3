import { z } from "zod";
import { itemTypeSchema } from "./inventory.js";
import { quantityString } from "./money.js";
import { locatedStockStatusSchema } from "./stock.js";

/**
 * Physical inventory locations (warehouses, rooms, bins, the receiving dock).
 * Quantity for located stock statuses (INV, QUARANTINE) is split across these;
 * cost stays item-level, so moving stock between locations never changes cost.
 *
 * Two per-tenant roles: `isDefault` is where usable (INV) stock lands by default
 * (a single default per tenant); `isReceiving` is where received goods are
 * quarantined on arrival (a single receiving location per tenant).
 */
export const locationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  isDefault: z.boolean(),
  isReceiving: z.boolean(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().max(30).optional(),
  isDefault: z.boolean().default(false),
  isReceiving: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const updateLocationSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  code: z.string().trim().max(30).nullable().optional(),
  isDefault: z.boolean().optional(),
  isReceiving: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Move a quantity of an item between two locations within one stock status. */
export const moveStockSchema = z
  .object({
    status: locatedStockStatusSchema.default("INV"),
    fromLocationId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    quantity: quantityString,
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.fromLocationId !== d.toLocationId, {
    message: "Source and destination locations must differ",
    path: ["toLocationId"],
  });

/** An item's quantity in one (status, location) cell. Cost is item-level. */
export const itemLocationPositionSchema = z.object({
  itemId: z.string().uuid(),
  status: locatedStockStatusSchema,
  locationId: z.string().uuid(),
  locationName: z.string(),
  locationCode: z.string().nullable(),
  quantity: z.string(),
});

/** One physical move record (the append-only location ledger). */
export const locationMoveSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  status: locatedStockStatusSchema,
  fromLocationId: z.string().uuid().nullable(),
  fromLocationName: z.string().nullable(),
  toLocationId: z.string().uuid().nullable(),
  toLocationName: z.string().nullable(),
  quantity: z.string(),
  note: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

/** One item's quantity sitting in a location (for the location-contents view). */
export const locationStockRowSchema = z.object({
  locationId: z.string().uuid(),
  locationName: z.string(),
  locationCode: z.string().nullable(),
  itemId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  itemType: itemTypeSchema,
  status: locatedStockStatusSchema,
  quantity: z.string(),
  unitCost: z.string(),
  totalValue: z.string(),
});

export type Location = z.infer<typeof locationSchema>;
export type LocationStockRow = z.infer<typeof locationStockRowSchema>;
export type CreateLocation = z.infer<typeof createLocationSchema>;
export type UpdateLocation = z.infer<typeof updateLocationSchema>;
export type MoveStock = z.infer<typeof moveStockSchema>;
export type ItemLocationPosition = z.infer<typeof itemLocationPositionSchema>;
export type LocationMove = z.infer<typeof locationMoveSchema>;

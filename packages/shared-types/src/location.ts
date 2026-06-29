import { z } from "zod";
import { itemTypeSchema } from "./inventory.js";
import { quantityString } from "./money.js";
import { locatedStockStatusSchema } from "./stock.js";

/**
 * Physical inventory locations form a tree of typed levels:
 *
 *   BUILDING (bbb)  →  AISLE (a)  →  RACK (first n; bin/sub-bin reserved)
 *
 * plus AREA nodes (e.g. a receiving dock) that hang directly off a building for
 * spots that don't follow the rack grid. Codes follow "bbb-a-nnn":
 *   - bbb : 3-digit building code (from the physical address)
 *   - a   : aisle letter A-Z
 *   - nnn : rack in the first digit (odd = left, even = right, like street
 *           addresses), the last two digits reserved for bin/sub-bin (0 for now)
 *
 * Stock sits at the leaves (RACK and AREA); BUILDING/AISLE are organizational.
 * `isDefault` (usable stock lands here) and `isReceiving` (receipts quarantine
 * here) are scoped per building.
 */
export const LOCATION_KINDS = ["BUILDING", "AISLE", "RACK", "AREA"] as const;
export const locationKindSchema = z.enum(LOCATION_KINDS);
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Only leaves hold stock. */
export const STOCKABLE_LOCATION_KINDS = ["RACK", "AREA"] as const;
export function isStockableKind(kind: LocationKind): boolean {
  return kind === "RACK" || kind === "AREA";
}

/** The parent kind each level must hang off (BUILDING is a root). */
export const PARENT_KIND: Record<LocationKind, LocationKind | null> = {
  BUILDING: null,
  AISLE: "BUILDING",
  RACK: "AISLE",
  AREA: "BUILDING",
};

export const rackSideSchema = z.enum(["LEFT", "RIGHT"]);
export type RackSide = z.infer<typeof rackSideSchema>;

export const BUILDING_CODE_RE = /^\d{3}$/;
export const AISLE_CODE_RE = /^[A-Z]$/;
export const AREA_CODE_RE = /^[A-Z0-9]{1,8}$/;
export const RACK_MIN = 1;
export const RACK_MAX = 9;

/** Rack n -> the 3-digit nnn segment ("1" -> "100"); bin/sub-bin reserved as 0. */
export function rackSegment(rack: number): string {
  return `${rack}00`;
}

/** Odd racks are on the left of the aisle, even on the right (street-address style). */
export function rackSide(rack: number): RackSide {
  return rack % 2 === 1 ? "LEFT" : "RIGHT";
}

/** This node's own code segment from its kind + raw input value. */
export function locationSegment(kind: LocationKind, value: string): string {
  return kind === "RACK" ? rackSegment(Number(value)) : value;
}

/** The full "bbb-a-nnn" code, given the parent's full code (null for buildings). */
export function composeLocationCode(
  kind: LocationKind,
  parentCode: string | null,
  value: string,
): string {
  const segment = locationSegment(kind, value);
  return kind === "BUILDING" ? segment : `${parentCode ?? ""}-${segment}`;
}

export const locationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  kind: locationKindSchema,
  parentId: z.string().uuid().nullable(),
  buildingId: z.string().uuid().nullable(),
  name: z.string(),
  /** This node's own code part (e.g. "075", "A", "100", "RECV"). */
  segment: z.string(),
  /** Full composed code, e.g. "075-A-100". */
  code: z.string(),
  side: rackSideSchema.nullable(),
  isDefault: z.boolean(),
  isReceiving: z.boolean(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Create one location node. `value` is the kind's raw segment input:
 *   BUILDING -> 3 digits, AISLE -> one letter, RACK -> rack number 1-9,
 *   AREA -> a short A-Z0-9 token. Non-building nodes require a parent.
 */
export const createLocationSchema = z
  .object({
    kind: locationKindSchema,
    name: z.string().trim().min(1).max(100),
    parentId: z.string().uuid().optional(),
    value: z.string().trim().min(1).max(20),
    isDefault: z.boolean().default(false),
    isReceiving: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "BUILDING") {
      if (d.parentId)
        ctx.addIssue({ code: "custom", path: ["parentId"], message: "A building has no parent" });
      if (!BUILDING_CODE_RE.test(d.value))
        ctx.addIssue({ code: "custom", path: ["value"], message: "Building code must be 3 digits (e.g. 075)" });
    } else if (!d.parentId) {
      ctx.addIssue({ code: "custom", path: ["parentId"], message: "A parent location is required" });
    }
    if (d.kind === "AISLE" && !AISLE_CODE_RE.test(d.value))
      ctx.addIssue({ code: "custom", path: ["value"], message: "Aisle must be a single letter A-Z" });
    if (d.kind === "RACK") {
      const n = Number(d.value);
      if (!Number.isInteger(n) || n < RACK_MIN || n > RACK_MAX)
        ctx.addIssue({ code: "custom", path: ["value"], message: `Rack must be a number ${RACK_MIN}-${RACK_MAX}` });
    }
    if (d.kind === "AREA" && !AREA_CODE_RE.test(d.value))
      ctx.addIssue({ code: "custom", path: ["value"], message: "Area code must be 1-8 letters/digits (e.g. RECV)" });
    if ((d.isDefault || d.isReceiving) && !isStockableKind(d.kind))
      ctx.addIssue({ code: "custom", path: ["kind"], message: "Only racks and areas can be default/receiving" });
  });

/** Edit a location's label, role flags, or active state (code/kind are immutable). */
export const updateLocationSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
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
  buildingName: z.string().nullable(),
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

/**
 * Stockable leaf location ids within a cycle-count scope, computed in-memory.
 * A `null` scopeLocationId (whole tenant) returns `null` = no restriction.
 * Mirrors CycleCountService.resolveScopeLeaves: a RACK/AREA scope is itself;
 * a BUILDING expands to its racks/areas; an AISLE to the racks under it.
 */
export function scopeLeafLocationIds(
  locations: Location[],
  scopeLocationId: string | null,
): string[] | null {
  if (!scopeLocationId) return null;
  const scope = locations.find((l) => l.id === scopeLocationId);
  if (!scope) return [];
  if (isStockableKind(scope.kind)) return [scope.id];
  return locations
    .filter(
      (l) =>
        isStockableKind(l.kind) &&
        (scope.kind === "BUILDING"
          ? l.buildingId === scope.id
          : l.parentId === scope.id),
    )
    .map((l) => l.id);
}
export type CreateLocation = z.infer<typeof createLocationSchema>;
export type UpdateLocation = z.infer<typeof updateLocationSchema>;
export type MoveStock = z.infer<typeof moveStockSchema>;
export type ItemLocationPosition = z.infer<typeof itemLocationPositionSchema>;
export type LocationMove = z.infer<typeof locationMoveSchema>;
export type LocationStockRow = z.infer<typeof locationStockRowSchema>;

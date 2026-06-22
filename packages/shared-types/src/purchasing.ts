import { z } from "zod";
import { unitOfMeasureSchema } from "./inventory.js";
import { moneyString, quantityString } from "./money.js";
import {
  addressInputSchema,
  addressSchema,
  contactInputSchema,
  contactSchema,
  paymentTermsSchema,
} from "./party.js";

/** Purchasing: vendors, purchase orders, and receipts against them. */

// ---- Vendor ----
export const createVendorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  website: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(50).optional(),
  paymentTerms: paymentTermsSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
  /**
   * What the vendor supplies — most provide raw materials/bases OR containers
   * (some both). Drives which line subjects the PO page offers for this vendor.
   */
  suppliesMaterials: z.boolean().default(true),
  suppliesContainers: z.boolean().default(false),
  /** Full set of addresses / contacts; on update these replace the existing set. */
  addresses: z.array(addressInputSchema).default([]),
  contacts: z.array(contactInputSchema).default([]),
});
export const updateVendorSchema = createVendorSchema.partial();

export const vendorSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  taxId: z.string().nullable(),
  paymentTerms: paymentTermsSchema.nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  suppliesMaterials: z.boolean(),
  suppliesContainers: z.boolean(),
  addresses: z.array(addressSchema),
  contacts: z.array(contactSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * Per-vendor purchase history, derived from prior (non-cancelled) POs — what
 * we've actually bought from each vendor. Drives "purchased before" tracking and
 * emphasizing vendors who've fulfilled similar orders.
 */
export const vendorSupplySummarySchema = z.object({
  vendorId: z.string().uuid(),
  poCount: z.number().int(),
  lastOrderAt: z.string().datetime().nullable(),
  /** Distinct item / container ids this vendor has supplied before. */
  itemIds: z.array(z.string().uuid()),
  containerIds: z.array(z.string().uuid()),
});

// ---- Purchase order ----
export const PO_STATUSES = ["OPEN", "PARTIAL", "RECEIVED", "CANCELLED"] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

const positiveQty = quantityString.refine(
  (v) => Number(v) > 0,
  "must be greater than 0",
);

/** A PO line buys either an inventory item or a container — exactly one. */
export const PO_LINE_TYPES = ["ITEM", "CONTAINER"] as const;
export const poLineTypeSchema = z.enum(PO_LINE_TYPES);
export type PoLineType = (typeof PO_LINE_TYPES)[number];

/** Define a brand-new material/base inline on a PO line (created when the PO is). */
export const poNewItemSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  // Procurable tiers only — finished goods aren't purchased.
  itemType: z.enum(["RAW_MATERIAL", "SEMI_FINISHED"]),
  unitOfMeasure: unitOfMeasureSchema.default("LB"),
});

export const poLineInputSchema = z
  .object({
    itemId: z.string().uuid().nullish(),
    containerId: z.string().uuid().nullish(),
    /** Create a new item inline; mutually exclusive with itemId/containerId. */
    newItem: poNewItemSchema.nullish(),
    quantityOrdered: positiveQty,
    unitCost: moneyString,
    sortOrder: z.number().int().min(0).default(0),
  })
  .refine(
    (l) =>
      (l.itemId ? 1 : 0) + (l.containerId ? 1 : 0) + (l.newItem ? 1 : 0) === 1,
    "a line must reference exactly one item, container, or new item",
  );

export const createPurchaseOrderSchema = z.object({
  vendorId: z.string().uuid(),
  poNumber: z.string().trim().min(1).max(50),
  orderDate: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(poLineInputSchema).min(1),
});

export const updatePurchaseOrderSchema = z.object({
  vendorId: z.string().uuid().optional(),
  poNumber: z.string().trim().min(1).max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(poLineInputSchema).min(1).optional(),
});

/** Receive specified quantities against PO lines (each creates a quarantined lot). */
export const receivePurchaseOrderSchema = z.object({
  /**
   * Receiving area the goods land in (a location flagged isReceiving). Drives
   * which building's default storage QC approval routes to. Defaults to the
   * tenant's first receiving area if omitted.
   */
  locationId: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().uuid(),
        quantity: positiveQty,
        /** Supplier's lot number for QC traceability; auto-generated if omitted. */
        supplierLotNumber: z.string().trim().max(80).optional(),
      }),
    )
    .min(1),
});

export const poLineSchema = z.object({
  id: z.string().uuid(),
  lineType: poLineTypeSchema,
  itemId: z.string().uuid().nullable(),
  containerId: z.string().uuid().nullable(),
  /** SKU / name of the line's subject (item or container). */
  sku: z.string(),
  name: z.string(),
  /** Item handling unit (KG lines are entered in kg, stored as lb); null for containers (counted each). */
  handlingUnit: unitOfMeasureSchema.nullable(),
  quantityOrdered: z.string(),
  unitCost: z.string(),
  quantityReceived: z.string(),
  lineValue: z.string(),
  sortOrder: z.number().int(),
});

/**
 * One posted receipt against a PO line — a single receiving event. Partial
 * receipts produce multiple rows (one per receive of a line), each with its own
 * timestamp + lot, so the receiving history against the PO is fully auditable.
 */
export const poReceiptSchema = z.object({
  id: z.string().uuid(),
  lineType: poLineTypeSchema,
  purchaseOrderLineId: z.string().uuid().nullable(),
  /** The received subject (item or container). */
  subjectId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  quantity: z.string(),
  unitCost: z.string(),
  /** Supplier lot / QC only apply to item receipts; null for containers. */
  lotNumber: z.string().nullable(),
  locationCode: z.string().nullable(),
  qcStatus: z.string().nullable(),
  receivedAt: z.string().datetime(),
});

export const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  vendorId: z.string().uuid(),
  vendorName: z.string(),
  poNumber: z.string(),
  status: z.enum(PO_STATUSES),
  orderDate: z.string().datetime(),
  notes: z.string().nullable(),
  totalValue: z.string(),
  lines: z.array(poLineSchema),
  receipts: z.array(poReceiptSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const purchaseOrderSummarySchema = purchaseOrderSchema
  .omit({ lines: true, receipts: true })
  .extend({ lineCount: z.number().int() });

export type CreateVendor = z.infer<typeof createVendorSchema>;
export type UpdateVendor = z.infer<typeof updateVendorSchema>;
export type Vendor = z.infer<typeof vendorSchema>;
export type VendorSupplySummary = z.infer<typeof vendorSupplySummarySchema>;
export type PoNewItem = z.infer<typeof poNewItemSchema>;
export type PurchaseOrderLineInput = z.infer<typeof poLineInputSchema>;
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceivePurchaseOrder = z.infer<typeof receivePurchaseOrderSchema>;
export type PurchaseOrderLine = z.infer<typeof poLineSchema>;
export type PoReceipt = z.infer<typeof poReceiptSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderSummary = z.infer<typeof purchaseOrderSummarySchema>;

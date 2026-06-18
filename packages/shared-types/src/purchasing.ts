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
  addresses: z.array(addressSchema),
  contacts: z.array(contactSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ---- Purchase order ----
export const PO_STATUSES = ["OPEN", "PARTIAL", "RECEIVED", "CANCELLED"] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

const positiveQty = quantityString.refine(
  (v) => Number(v) > 0,
  "must be greater than 0",
);

export const poLineInputSchema = z.object({
  itemId: z.string().uuid(),
  quantityOrdered: positiveQty,
  unitCost: moneyString,
  sortOrder: z.number().int().min(0).default(0),
});

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
  itemId: z.string().uuid(),
  itemSku: z.string(),
  itemName: z.string(),
  /** The item's handling unit. KG lines are entered in kg and stored as lb. */
  handlingUnit: unitOfMeasureSchema,
  quantityOrdered: z.string(),
  unitCost: z.string(),
  quantityReceived: z.string(),
  lineValue: z.string(),
  sortOrder: z.number().int(),
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const purchaseOrderSummarySchema = purchaseOrderSchema
  .omit({ lines: true })
  .extend({ lineCount: z.number().int() });

export type CreateVendor = z.infer<typeof createVendorSchema>;
export type UpdateVendor = z.infer<typeof updateVendorSchema>;
export type Vendor = z.infer<typeof vendorSchema>;
export type PurchaseOrderLineInput = z.infer<typeof poLineInputSchema>;
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceivePurchaseOrder = z.infer<typeof receivePurchaseOrderSchema>;
export type PurchaseOrderLine = z.infer<typeof poLineSchema>;
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderSummary = z.infer<typeof purchaseOrderSummarySchema>;

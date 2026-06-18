import { z } from "zod";
import { moneyString, quantityString } from "./money.js";
import {
  addressInputSchema,
  addressSchema,
  contactInputSchema,
  contactSchema,
  paymentTermsSchema,
} from "./party.js";

/** Sales: customers, sales orders, and shipments against them. */

// ---- Customer ----
/**
 * Sales-team buy-volume rating: A = highest, most consistent volume … D = small,
 * infrequent orders.
 */
export const CUSTOMER_RATINGS = ["A", "B", "C", "D"] as const;
export const customerRatingSchema = z.enum(CUSTOMER_RATINGS);
export type CustomerRating = (typeof CUSTOMER_RATINGS)[number];

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  website: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(50).optional(),
  paymentTerms: paymentTermsSchema.optional(),
  rating: customerRatingSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
  /** Full set of addresses / contacts; on update these replace the existing set. */
  addresses: z.array(addressInputSchema).default([]),
  contacts: z.array(contactInputSchema).default([]),
});
export const updateCustomerSchema = createCustomerSchema.partial();

export const customerSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  taxId: z.string().nullable(),
  paymentTerms: paymentTermsSchema.nullable(),
  rating: customerRatingSchema.nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  addresses: z.array(addressSchema),
  contacts: z.array(contactSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ---- Sales order ----
export const SO_STATUSES = ["OPEN", "PARTIAL", "SHIPPED", "CANCELLED"] as const;
export type SalesOrderStatus = (typeof SO_STATUSES)[number];

const positiveQty = quantityString.refine(
  (v) => Number(v) > 0,
  "must be greater than 0",
);

export const soLineInputSchema = z.object({
  itemId: z.string().uuid(),
  quantityOrdered: positiveQty,
  unitPrice: moneyString,
  sortOrder: z.number().int().min(0).default(0),
});

export const createSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  soNumber: z.string().trim().min(1).max(50),
  orderDate: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(soLineInputSchema).min(1),
});

export const updateSalesOrderSchema = z.object({
  customerId: z.string().uuid().optional(),
  soNumber: z.string().trim().min(1).max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(soLineInputSchema).min(1).optional(),
});

/** Ship specified quantities against SO lines. */
export const shipSalesOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        salesOrderLineId: z.string().uuid(),
        quantity: positiveQty,
      }),
    )
    .min(1),
});

export const soLineSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  itemSku: z.string(),
  itemName: z.string(),
  quantityOrdered: z.string(),
  unitPrice: z.string(),
  quantityShipped: z.string(),
  lineRevenue: z.string(),
  sortOrder: z.number().int(),
});

export const salesOrderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  soNumber: z.string(),
  status: z.enum(SO_STATUSES),
  orderDate: z.string().datetime(),
  notes: z.string().nullable(),
  totalRevenue: z.string(),
  lines: z.array(soLineSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const salesOrderSummarySchema = salesOrderSchema
  .omit({ lines: true })
  .extend({ lineCount: z.number().int() });

export type CreateCustomer = z.infer<typeof createCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type SalesOrderLineInput = z.infer<typeof soLineInputSchema>;
export type CreateSalesOrder = z.infer<typeof createSalesOrderSchema>;
export type UpdateSalesOrder = z.infer<typeof updateSalesOrderSchema>;
export type ShipSalesOrder = z.infer<typeof shipSalesOrderSchema>;
export type SalesOrderLine = z.infer<typeof soLineSchema>;
export type SalesOrder = z.infer<typeof salesOrderSchema>;
export type SalesOrderSummary = z.infer<typeof salesOrderSummarySchema>;

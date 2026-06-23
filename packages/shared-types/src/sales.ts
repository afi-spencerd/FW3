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
  /** Container the goods will be packed in (optional; customer-driven). */
  containerId: z.string().uuid().nullish(),
  /** How many of that container — defaults from capacity but is overridable. */
  containerQuantity: positiveQty.nullish(),
});

export const createSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  soNumber: z.string().trim().min(1).max(50),
  orderDate: z.string().datetime().optional(),
  /** When sales has committed to ship by; drives scheduler RUSH/sequencing. */
  requestedShipDate: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(soLineInputSchema).min(1),
  /** Permit lines priced below cost (requires the so:price-override permission). */
  allowBelowCost: z.boolean().optional(),
});

export const updateSalesOrderSchema = z.object({
  customerId: z.string().uuid().optional(),
  soNumber: z.string().trim().min(1).max(50).optional(),
  requestedShipDate: z.string().datetime().nullish(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(soLineInputSchema).min(1).optional(),
  allowBelowCost: z.boolean().optional(),
});

/** What a customer has historically paid for an item (across non-cancelled orders). */
export const customerItemPriceSchema = z.object({
  itemId: z.string().uuid(),
  itemSku: z.string(),
  itemName: z.string(),
  /** Quantity-weighted average unit price. */
  avgUnitPrice: z.string(),
  /** Unit price on the most recent order. */
  lastUnitPrice: z.string(),
  /** Number of distinct orders that included this item. */
  orderCount: z.number().int(),
});

/** Computed cost basis for an item (per lb): material roll-up × production factor. */
export const itemCostSchema = z.object({
  itemId: z.string().uuid(),
  /** Σ(effective RM fraction × RM unit cost), per lb. */
  materialUnitCost: z.string(),
  /** The productionCostFactor business variable applied. */
  productionCostFactor: z.string(),
  /** materialUnitCost × productionCostFactor, per lb (excludes container). */
  productionUnitCost: z.string(),
});

/**
 * Ship specified quantities against SO lines. Each call produces one Shipment
 * record (a single despatch) with optional carrier + tracking details.
 */
export const shipSalesOrderSchema = z.object({
  carrier: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        salesOrderLineId: z.string().uuid(),
        quantity: positiveQty,
      }),
    )
    .min(1),
});

/** Edit a shipment's carrier / tracking after the fact (e.g. tracking# assigned at pickup). */
export const updateShipmentSchema = z.object({
  carrier: z.string().trim().max(100).nullish(),
  trackingNumber: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(500).nullish(),
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
  /** Packing plan: the chosen container and how many (null if not packed in a container). */
  containerId: z.string().uuid().nullable(),
  containerSku: z.string().nullable(),
  containerName: z.string().nullable(),
  containerQuantity: z.string().nullable(),
});

/** One line of a shipment — the quantity of an SO line despatched, at COGS. */
export const shipmentLineSchema = z.object({
  id: z.string().uuid(),
  salesOrderLineId: z.string().uuid(),
  itemId: z.string().uuid(),
  itemSku: z.string(),
  itemName: z.string(),
  quantity: z.string(),
  /** Cost of goods at ship time (per unit / total). */
  unitCost: z.string(),
  value: z.string(),
});

/** A first-class shipment against a sales order: one despatch with tracking. */
export const shipmentSchema = z.object({
  id: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  shipmentNumber: z.string(),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  notes: z.string().nullable(),
  shippedByName: z.string().nullable(),
  shippedAt: z.string().datetime(),
  lines: z.array(shipmentLineSchema),
  totalValue: z.string(),
});

/** A production work order spawned from this sales order (shown on the SO detail). */
export const salesOrderWorkOrderSchema = z.object({
  id: z.string().uuid(),
  workOrderNumber: z.string(),
  status: z.string(),
  targetName: z.string(),
  salesOrderLineId: z.string().uuid().nullable(),
});

export const salesOrderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  soNumber: z.string(),
  status: z.enum(SO_STATUSES),
  orderDate: z.string().datetime(),
  /** Sales' committed ship-by date (drives scheduler RUSH/sequencing); null if unset. */
  requestedShipDate: z.string().datetime().nullable(),
  /** When payment was recorded; null until paid (net-terms customers may skip). */
  paidAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  totalRevenue: z.string(),
  /** When the order's containers were consumed (packed); null until packed. */
  packedAt: z.string().datetime().nullable(),
  lines: z.array(soLineSchema),
  shipments: z.array(shipmentSchema),
  /** Production work orders requested from this order (empty until requested). */
  workOrders: z.array(salesOrderWorkOrderSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const salesOrderSummarySchema = salesOrderSchema
  .omit({ lines: true, shipments: true, workOrders: true })
  .extend({ lineCount: z.number().int() });

export type CreateCustomer = z.infer<typeof createCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type SalesOrderLineInput = z.infer<typeof soLineInputSchema>;
export type CreateSalesOrder = z.infer<typeof createSalesOrderSchema>;
export type UpdateSalesOrder = z.infer<typeof updateSalesOrderSchema>;
export type CustomerItemPrice = z.infer<typeof customerItemPriceSchema>;
export type ItemCost = z.infer<typeof itemCostSchema>;
export type ShipSalesOrder = z.infer<typeof shipSalesOrderSchema>;
export type UpdateShipment = z.infer<typeof updateShipmentSchema>;
export type SalesOrderLine = z.infer<typeof soLineSchema>;
export type ShipmentLine = z.infer<typeof shipmentLineSchema>;
export type Shipment = z.infer<typeof shipmentSchema>;
export type SalesOrderWorkOrder = z.infer<typeof salesOrderWorkOrderSchema>;
export type SalesOrder = z.infer<typeof salesOrderSchema>;
export type SalesOrderSummary = z.infer<typeof salesOrderSummarySchema>;

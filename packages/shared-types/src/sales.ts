import { z } from "zod";
import { moneyString, quantityString } from "./money.js";
import {
  addressInputSchema,
  addressSchema,
  contactInputSchema,
  contactSchema,
  paymentMethodSchema,
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
  /** Maximum total open balance allowed; omitted = no limit. Enforced on SO create. */
  creditLimit: moneyString.optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
  /** Full set of addresses / contacts; on update these replace the existing set. */
  addresses: z.array(addressInputSchema).default([]),
  contacts: z.array(contactInputSchema).default([]),
});
// `creditLimit` overridden to nullish so an existing limit can be cleared (null = no limit).
export const updateCustomerSchema = createCustomerSchema
  .partial()
  .extend({ creditLimit: moneyString.nullish() });

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
  /** Maximum total open balance allowed; null = no limit. */
  creditLimit: z.string().nullable(),
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

/** What a sales line sells: an inventory item, or a container as the product. */
export const SO_LINE_TYPES = ["ITEM", "CONTAINER"] as const;
export const soLineTypeSchema = z.enum(SO_LINE_TYPES);
export type SoLineType = (typeof SO_LINE_TYPES)[number];

export const soLineInputSchema = z
  .object({
    lineType: soLineTypeSchema.default("ITEM"),
    /** The item sold (ITEM lines). */
    itemId: z.string().uuid().nullish(),
    /** The container sold as the product itself (CONTAINER lines). */
    productContainerId: z.string().uuid().nullish(),
    quantityOrdered: positiveQty,
    unitPrice: moneyString,
    sortOrder: z.number().int().min(0).default(0),
    /** Container the goods will be packed in (ITEM lines only; customer-driven). */
    containerId: z.string().uuid().nullish(),
    /** How many of that container — defaults from capacity but is overridable. */
    containerQuantity: positiveQty.nullish(),
  })
  .superRefine((line, ctx) => {
    if (line.lineType === "CONTAINER") {
      if (!line.productContainerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productContainerId"],
          message: "a container line must reference a container to sell",
        });
      }
    } else if (!line.itemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemId"],
        message: "an item line must reference an item",
      });
    }
  });

export const createSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  /** Omitted for new orders (auto-generated, SO-######); provided only on import/backfill. */
  soNumber: z.string().trim().min(1).max(50).optional(),
  /** The customer's purchase-order reference (free text). */
  customerPoNumber: z.string().trim().max(100).optional(),
  orderDate: z.string().datetime().optional(),
  /** When sales has committed to ship by; drives scheduler RUSH/sequencing. */
  requestedShipDate: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(soLineInputSchema).min(1),
  /** Permit lines priced below cost (requires the so:price-override permission). */
  allowBelowCost: z.boolean().optional(),
  /** Permit exceeding the customer's credit limit (requires so:credit-override). */
  allowOverLimit: z.boolean().optional(),
});

export const updateSalesOrderSchema = z.object({
  customerId: z.string().uuid().optional(),
  soNumber: z.string().trim().min(1).max(50).optional(),
  customerPoNumber: z.string().trim().max(100).nullish(),
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
  lineType: soLineTypeSchema,
  /** Item sold (ITEM lines); null on container lines. */
  itemId: z.string().uuid().nullable(),
  itemSku: z.string().nullable(),
  itemName: z.string().nullable(),
  /** Container sold as the product (CONTAINER lines); null on item lines. */
  productContainerId: z.string().uuid().nullable(),
  productContainerSku: z.string().nullable(),
  productContainerName: z.string().nullable(),
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
  lineType: soLineTypeSchema,
  /** The shipped subject — an item (ITEM lines) or a container (CONTAINER lines). */
  itemId: z.string().uuid().nullable(),
  itemSku: z.string().nullable(),
  itemName: z.string().nullable(),
  containerId: z.string().uuid().nullable(),
  containerSku: z.string().nullable(),
  containerName: z.string().nullable(),
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

// ---- Payments ----
const positiveMoney = moneyString.refine((v) => Number(v) > 0, "must be greater than 0");

/** Record a payment against an order. The convenience fee is computed server-side. */
export const recordPaymentSchema = z.object({
  amount: positiveMoney,
  method: paymentMethodSchema,
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export const salesOrderPaymentSchema = z.object({
  id: z.string().uuid(),
  amount: z.string(),
  method: paymentMethodSchema,
  /** Credit-card surcharge charged on top of `amount` (0 for other methods). */
  convenienceFee: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  receivedByName: z.string().nullable(),
  receivedAt: z.string().datetime(),
});

// ---- Refunds ----
/**
 * Why money is being returned. OVERPAYMENT: net payments exceed what's owed
 * (e.g. lines reduced after payment). CANCELLATION: an approved (CANCELLED)
 * order's payments are returned.
 */
export const REFUND_REASONS = ["OVERPAYMENT", "CANCELLATION"] as const;
export const refundReasonSchema = z.enum(REFUND_REASONS);
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Issue a refund against an order. Eligibility/amount are validated server-side. */
export const issueRefundSchema = z.object({
  amount: positiveMoney,
  method: paymentMethodSchema,
  reason: refundReasonSchema,
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export const salesOrderRefundSchema = z.object({
  id: z.string().uuid(),
  amount: z.string(),
  method: paymentMethodSchema,
  reason: refundReasonSchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  issuedByName: z.string().nullable(),
  issuedAt: z.string().datetime(),
});

/** One change-history entry for a sales order (from the audit log). */
export const auditEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  actorName: z.string().nullable(),
  /** JSON snapshots as stored; null where not captured. */
  before: z.string().nullable(),
  after: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const salesOrderSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  /** The customer's payment terms — lets the UI gate "request production". */
  customerPaymentTerms: paymentTermsSchema.nullable(),
  soNumber: z.string(),
  /** The customer's purchase-order reference (free text); null if unset. */
  customerPoNumber: z.string().nullable(),
  status: z.enum(SO_STATUSES),
  orderDate: z.string().datetime(),
  /** Sales' committed ship-by date (drives scheduler RUSH/sequencing); null if unset. */
  requestedShipDate: z.string().datetime().nullable(),
  /** When payment was recorded; null until paid (net-terms customers may skip). */
  paidAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
  totalRevenue: z.string(),
  /** Sum of recorded payment amounts (excludes convenience fees). */
  amountPaid: z.string(),
  /** Sum of issued refund amounts. */
  amountRefunded: z.string(),
  /** totalRevenue − (amountPaid − amountRefunded). */
  balanceDue: z.string(),
  /** What can still be refunded now: max(0, netPaid − amountOwed). */
  refundableAmount: z.string(),
  /** When the order's containers were consumed (packed); null until packed. */
  packedAt: z.string().datetime().nullable(),
  lines: z.array(soLineSchema),
  payments: z.array(salesOrderPaymentSchema),
  refunds: z.array(salesOrderRefundSchema),
  shipments: z.array(shipmentSchema),
  /** Production work orders requested from this order (empty until requested). */
  workOrders: z.array(salesOrderWorkOrderSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const salesOrderSummarySchema = salesOrderSchema
  .omit({ lines: true, shipments: true, workOrders: true, payments: true, refunds: true })
  .extend({ lineCount: z.number().int() });

// ---- CSV import ----
/**
 * One CSV row = one order line. Rows sharing a `soNumber` form a single order;
 * the order-level fields (customer, requestedShipDate, notes, allowBelowCost) are
 * taken from the order's first row. `customer` matches Customer.code, else name;
 * `sku` is an item SKU (ITEM) or container SKU (CONTAINER, sold as the product).
 */
export const importSalesOrderRowSchema = z.object({
  soNumber: z.string().trim().min(1).max(50),
  customer: z.string().trim().min(1).max(200),
  /** The customer's PO reference (order-level; taken from the first row). */
  customerPo: z.string().trim().max(100).optional(),
  lineType: soLineTypeSchema.default("ITEM"),
  sku: z.string().trim().min(1).max(64),
  quantity: positiveQty,
  unitPrice: moneyString,
  /** Optional ship-by; a plain date (YYYY-MM-DD) or ISO datetime. */
  requestedShipDate: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Optional packing container (ITEM lines), by SKU. */
  packingSku: z.string().trim().max(64).optional(),
  packingQty: positiveQty.optional(),
  allowBelowCost: z.boolean().optional(),
  allowOverLimit: z.boolean().optional(),
});

export const importSalesOrdersSchema = z.object({
  rows: z.array(importSalesOrderRowSchema).min(1),
});

export const IMPORT_RESULT_STATUSES = ["CREATED", "FAILED"] as const;
export const importResultRowSchema = z.object({
  soNumber: z.string(),
  status: z.enum(IMPORT_RESULT_STATUSES),
  salesOrderId: z.string().uuid().nullable(),
  lineCount: z.number().int(),
  error: z.string().nullable(),
});
export const importSalesOrdersResultSchema = z.object({
  results: z.array(importResultRowSchema),
  created: z.number().int(),
  failed: z.number().int(),
});

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
export type RecordPayment = z.infer<typeof recordPaymentSchema>;
export type SalesOrderPayment = z.infer<typeof salesOrderPaymentSchema>;
export type IssueRefund = z.infer<typeof issueRefundSchema>;
export type SalesOrderRefund = z.infer<typeof salesOrderRefundSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type ImportSalesOrderRow = z.infer<typeof importSalesOrderRowSchema>;
export type ImportSalesOrders = z.infer<typeof importSalesOrdersSchema>;
export type ImportResultRow = z.infer<typeof importResultRowSchema>;
export type ImportSalesOrdersResult = z.infer<typeof importSalesOrdersResultSchema>;

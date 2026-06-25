import { z } from "zod";
import { paymentTermsSchema } from "./party.js";

/**
 * Accounts receivable — what customers owe, derived live from their sales orders
 * (open balance = totalRevenue − net payments, per order). Nothing is stored;
 * these are computed views over SalesOrder + payments + refunds.
 */

/** Outstanding balance split by how far past due each order is (money strings). */
export const arAgingSchema = z.object({
  /** Not yet past its due date. */
  current: z.string(),
  /** 1–30 days past due. */
  d1_30: z.string(),
  /** 31–60 days past due. */
  d31_60: z.string(),
  /** 61–90 days past due. */
  d61_90: z.string(),
  /** More than 90 days past due. */
  d90_plus: z.string(),
});

/** One customer's AR position on the receivables list. */
export const arSummaryRowSchema = z.object({
  customerId: z.string().uuid(),
  customerName: z.string(),
  /** null = no credit limit set. */
  creditLimit: z.string().nullable(),
  /** Total open balance across non-cancelled orders (clamped ≥ 0 per order). */
  currentExposure: z.string(),
  /** creditLimit − currentExposure; null when no limit is set. */
  availableCredit: z.string().nullable(),
  aging: arAgingSchema,
  /** Number of orders contributing a positive balance. */
  openOrderCount: z.number().int(),
  /** Days past due of the oldest past-due order (0 if none are past due). */
  oldestPastDueDays: z.number().int(),
});

/** One open order in a customer's AR breakdown. */
export const arOrderSchema = z.object({
  salesOrderId: z.string().uuid(),
  soNumber: z.string(),
  orderDate: z.string().datetime(),
  /** orderDate + payment-term days. */
  dueDate: z.string().datetime(),
  balanceDue: z.string(),
  /** Which aging bucket this order falls in. */
  bucket: z.enum(["current", "d1_30", "d31_60", "d61_90", "d90_plus"]),
  /** Days past due (0 if not yet due). */
  daysPastDue: z.number().int(),
});

/** A single customer's full AR detail. */
export const arDetailSchema = arSummaryRowSchema.extend({
  customerPaymentTerms: paymentTermsSchema.nullable(),
  orders: z.array(arOrderSchema),
});

export type ArAging = z.infer<typeof arAgingSchema>;
export type ArSummaryRow = z.infer<typeof arSummaryRowSchema>;
export type ArOrder = z.infer<typeof arOrderSchema>;
export type ArDetail = z.infer<typeof arDetailSchema>;

import { z } from "zod";

/**
 * Shared address + contact shapes for business partners (vendors and customers).
 * A partner can have many addresses (billing, shipping, remit-to, …) and many
 * contacts. Used nested inside the vendor/customer create/update/read schemas.
 */

export const ADDRESS_KINDS = ["BILLING", "SHIPPING", "REMIT_TO", "OTHER"] as const;
export const addressKindSchema = z.enum(ADDRESS_KINDS);
export type AddressKind = (typeof ADDRESS_KINDS)[number];

/** Standard payment terms (aligned with common QuickBooks terms). */
export const PAYMENT_TERMS = [
  "DUE_ON_RECEIPT",
  "NET_15",
  "NET_30",
  "NET_45",
  "NET_60",
  "NET_90",
  "COD",
  "PREPAID",
] as const;
export const paymentTermsSchema = z.enum(PAYMENT_TERMS);
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/** How a payment was tendered. Credit-card payments carry a convenience fee. */
export const PAYMENT_METHODS = [
  "CASH",
  "CHECK",
  "CREDIT_CARD",
  "ACH",
  "WIRE",
  "OTHER",
] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Terms that let a customer receive goods before paying — used to decide whether
 * a sales order can be sent to production without a recorded payment.
 */
export const NET_PAYMENT_TERMS = [
  "NET_15",
  "NET_30",
  "NET_45",
  "NET_60",
  "NET_90",
] as const satisfies readonly PaymentTerms[];

export const addressInputSchema = z.object({
  kind: addressKindSchema.default("OTHER"),
  label: z.string().trim().max(100).optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(), // state / province
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(100).optional(),
  isPrimary: z.boolean().default(false),
});

export const addressSchema = z.object({
  id: z.string().uuid(),
  kind: addressKindSchema,
  label: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  isPrimary: z.boolean(),
});

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(100).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
});

export const contactSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
  notes: z.string().nullable(),
});

export type AddressInput = z.infer<typeof addressInputSchema>;
export type Address = z.infer<typeof addressSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;
export type Contact = z.infer<typeof contactSchema>;

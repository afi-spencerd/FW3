import { z } from "zod";

/**
 * Money and quantity cross the wire as decimal STRINGS, never JS numbers.
 * Floats silently lose precision on financial math (0.1 + 0.2 !== 0.3), so the
 * API serializes Prisma.Decimal / SQL DECIMAL columns to strings and the client
 * treats them as opaque decimals. Parse/format for display only.
 *
 * Scales mirror the DB column definitions (see prisma schema):
 *   - money   DECIMAL(19,4)  -> up to 4 fractional digits
 *   - qty     DECIMAL(18,4)  -> up to 4 fractional digits
 */
const DECIMAL_4DP = /^-?\d{1,15}(\.\d{1,4})?$/;

/** A non-negative monetary amount, e.g. unit cost / sales price. */
export const moneyString = z
  .string()
  .regex(DECIMAL_4DP, "must be a decimal with up to 4 places")
  .refine((v) => !v.startsWith("-"), "must not be negative");

/** A quantity that may be fractional (e.g. weight-based UoM) but not negative. */
export const quantityString = z
  .string()
  .regex(DECIMAL_4DP, "must be a decimal with up to 4 places")
  .refine((v) => !v.startsWith("-"), "must not be negative");

export type MoneyString = z.infer<typeof moneyString>;
export type QuantityString = z.infer<typeof quantityString>;

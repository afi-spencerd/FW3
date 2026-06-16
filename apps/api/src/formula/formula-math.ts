import Decimal from "decimal.js";
import type { DecimalInput } from "../inventory/valuation";

/**
 * Formula scaling math — pure and tested. A formula is percentage-by-weight, so
 * a line's absolute weight for a batch is batchSize * percentage / 100, computed
 * with decimal precision (this feeds material requirements and, later, the
 * inventory a production run consumes — the money/quantity zone).
 *
 * The result is in the batch's unit; converting to each material's stocking unit
 * is done separately via convertWeight (units.ts).
 */
export function requiredWeight(
  batchSize: DecimalInput,
  percentage: DecimalInput,
): string {
  return new Decimal(batchSize).times(percentage).div(100).toString();
}

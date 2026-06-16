import Decimal from "decimal.js";
import type { UnitOfMeasure } from "@fw3/shared-types";
import type { DecimalInput } from "./valuation";

/**
 * Weight unit conversion (LB <-> KG) with decimal precision. Inventory is stored
 * mostly in pounds, some in kilograms; formulas and production will need to
 * convert between a material's stocking unit and a formula's unit. Kept pure and
 * tested — measurement math is in the "slow down and test" zone.
 *
 * 1 kg = 2.20462262 lb (the conversion the business uses).
 */
export const LB_PER_KG = "2.20462262";

export function convertWeight(
  quantity: DecimalInput,
  from: UnitOfMeasure,
  to: UnitOfMeasure,
): string {
  const qty = new Decimal(quantity);
  if (from === to) return qty.toString();
  if (from === "KG" && to === "LB") return qty.times(LB_PER_KG).toString();
  // LB -> KG
  return qty.div(LB_PER_KG).toString();
}

import Decimal from "decimal.js";
import { LB_PER_KG, type UnitOfMeasure } from "@fw3/shared-types";
import type { DecimalInput } from "./valuation";

/**
 * Weight unit conversion (LB <-> KG) with decimal precision. Pounds is the
 * canonical stored/batched unit; kilograms are converted in at the edges
 * (receipt). Kept pure and tested — measurement math is in the "slow down and
 * test" zone. 1 kg = 2.20462262 lb (the conversion the business uses).
 */
export { LB_PER_KG };

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

/** A quantity in an item's handling unit, expressed in canonical pounds. */
export function toPounds(
  quantity: DecimalInput,
  handlingUnit: UnitOfMeasure,
): string {
  return convertWeight(quantity, handlingUnit, "LB");
}

/**
 * A unit cost in an item's handling unit, expressed per pound. Cost converts
 * inversely to quantity so total value is preserved: $/kg ÷ (lb/kg) = $/lb.
 */
export function unitCostToPounds(
  unitCost: DecimalInput,
  handlingUnit: UnitOfMeasure,
): string {
  const cost = new Decimal(unitCost);
  return handlingUnit === "KG" ? cost.div(LB_PER_KG).toString() : cost.toString();
}

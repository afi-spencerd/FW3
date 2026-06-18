import { kgEquivalent, type UnitOfMeasure } from "@fw3/shared-types";

/**
 * Render a canonical pounds quantity for display. KG-handled items also show the
 * kilogram equivalent; everything is stored in pounds. e.g. "26.4555 lb (12 kg)".
 */
export function weightLabel(poundsQty: string, handlingUnit: UnitOfMeasure): string {
  return handlingUnit === "KG"
    ? `${poundsQty} lb (${kgEquivalent(poundsQty)} kg)`
    : `${poundsQty} lb`;
}

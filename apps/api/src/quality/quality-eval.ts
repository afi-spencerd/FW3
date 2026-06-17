import Decimal from "decimal.js";
import { QC_TEST_KIND, type QcTestType } from "@fw3/shared-types";

export interface SpecLike {
  minValue: string | null;
  maxValue: string | null;
  expectedValue: string | null;
}

/**
 * Pass/fail of a measured QC result against the item's spec. Pure + tested.
 * NUMERIC tests (specific gravity, refractive index, Gardner color, melting
 * point) auto-evaluate against a min/max range. JUDGMENT tests (odor, appearance)
 * are decided by a person, so this returns null and the analyst sets pass/fail.
 */
export function evaluateResult(
  testType: QcTestType,
  measuredValue: string,
  spec: SpecLike | undefined,
): boolean | null {
  if (QC_TEST_KIND[testType] !== "NUMERIC") return null; // judgment: manual
  if (!spec || (spec.minValue == null && spec.maxValue == null)) return null;

  let value: Decimal;
  try {
    value = new Decimal(measuredValue);
  } catch {
    return false; // non-numeric reading for a numeric test
  }
  if (!value.isFinite()) return false;
  if (spec.minValue != null && value.lessThan(spec.minValue)) return false;
  if (spec.maxValue != null && value.greaterThan(spec.maxValue)) return false;
  return true;
}

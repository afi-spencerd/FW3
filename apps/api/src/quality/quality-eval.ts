import Decimal from "decimal.js";
import { QC_TEST_KIND, type QcTestType } from "@fw3/shared-types";

export interface SpecLike {
  minValue: string | null;
  maxValue: string | null;
  expectedValue: string | null;
}

/**
 * Pass/fail of a measured QC result against the item's spec. Pure + tested.
 * Returns null when it can't be determined automatically (no spec, or a
 * descriptive test with no expected value) — a human still approves the lot.
 */
export function evaluateResult(
  testType: QcTestType,
  measuredValue: string,
  spec: SpecLike | undefined,
): boolean | null {
  if (!spec) return null;

  if (QC_TEST_KIND[testType] === "NUMERIC") {
    let value: Decimal;
    try {
      value = new Decimal(measuredValue);
    } catch {
      return false; // non-numeric reading for a numeric test
    }
    if (!value.isFinite()) return false;
    if (spec.minValue == null && spec.maxValue == null) return null;
    if (spec.minValue != null && value.lessThan(spec.minValue)) return false;
    if (spec.maxValue != null && value.greaterThan(spec.maxValue)) return false;
    return true;
  }

  // DESCRIPTIVE
  if (spec.expectedValue == null || spec.expectedValue.trim() === "") return null;
  return (
    measuredValue.trim().toLowerCase() === spec.expectedValue.trim().toLowerCase()
  );
}

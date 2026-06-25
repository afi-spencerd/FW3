import Decimal from "decimal.js";
import { RECEIPT_TOLERANCE } from "@fw3/shared-types";

export type ReceivableStatus = "OPEN" | "PARTIAL" | "RECEIVED";

/**
 * Derive a purchase order's receiving status from its lines (CANCELLED is a
 * manual state, handled separately). A line counts as fully received once it's
 * within RECEIPT_TOLERANCE of ordered, so kg↔lb conversion rounding can't strand
 * a PO at PARTIAL by a fraction. Pure + tested.
 */
export function poStatusFromLines(
  lines: { quantityOrdered: string; quantityReceived: string }[],
): ReceivableStatus {
  let anyReceived = false;
  let allReceived = true;
  for (const line of lines) {
    const ordered = new Decimal(line.quantityOrdered);
    const received = new Decimal(line.quantityReceived);
    if (received.greaterThan(0)) anyReceived = true;
    if (received.lessThan(ordered.minus(RECEIPT_TOLERANCE))) allReceived = false;
  }
  if (allReceived) return "RECEIVED";
  if (anyReceived) return "PARTIAL";
  return "OPEN";
}

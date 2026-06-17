import Decimal from "decimal.js";

export type ReceivableStatus = "OPEN" | "PARTIAL" | "RECEIVED";

/**
 * Derive a purchase order's receiving status from its lines (CANCELLED is a
 * manual state, handled separately). Pure + tested.
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
    if (received.lessThan(ordered)) allReceived = false;
  }
  if (allReceived) return "RECEIVED";
  if (anyReceived) return "PARTIAL";
  return "OPEN";
}

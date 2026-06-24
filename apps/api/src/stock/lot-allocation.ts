import Decimal from "decimal.js";

/** A lot with its available quantity, in the priority order to draw down (FIFO). */
export interface LotAvailability {
  lotId: string;
  available: string;
}

/** A slice of an outbound quantity attributed to a lot (or null when uncovered). */
export interface LotAllocation {
  lotId: string | null;
  quantity: string;
}

/**
 * Allocate an outbound `quantity` across `lots` in the given order (oldest first),
 * taking as much as each lot has available before moving on. Any quantity not
 * covered by the lots becomes a trailing `{ lotId: null }` remainder — so the
 * allocations always sum to exactly `quantity` (this keeps item-level balances
 * correct even on legacy stock that predates lot tracking). Zero slices are omitted.
 */
export function allocateLots(
  lots: LotAvailability[],
  quantity: string,
): LotAllocation[] {
  const out: LotAllocation[] = [];
  let remaining = new Decimal(quantity);
  for (const lot of lots) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const avail = new Decimal(lot.available);
    if (avail.lessThanOrEqualTo(0)) continue;
    const take = Decimal.min(remaining, avail);
    out.push({ lotId: lot.lotId, quantity: take.toString() });
    remaining = remaining.minus(take);
  }
  if (remaining.greaterThan(0)) {
    out.push({ lotId: null, quantity: remaining.toString() });
  }
  return out;
}

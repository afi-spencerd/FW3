import Decimal from "decimal.js";
import type { DecimalInput } from "../inventory/valuation";

/**
 * Weighted-average (moving) cost math — pure and tested. Inbound movements
 * re-average the unit cost; outbound movements cost out at the current average
 * and leave it unchanged. All results are rounded to 4 dp to match the DB
 * columns (cost/qty are DECIMAL(_,4)). This is the money core — never floats.
 */
const DP = 4;

export interface Position {
  quantity: string;
  avgCost: string;
}

export interface PostingResult {
  /** Signed quantity applied (+ inbound, - outbound). */
  quantity: string;
  /** Unit cost applied by this movement. */
  unitCost: string;
  /** Signed value applied (= quantity * unitCost). */
  value: string;
  /** On-hand quantity after the movement. */
  balanceQty: string;
  /** Moving average cost after the movement. */
  balanceAvgCost: string;
}

export class InsufficientStockError extends Error {
  constructor(
    readonly available: string,
    readonly requested: string,
  ) {
    super(`Insufficient stock: have ${available}, need ${requested}`);
    this.name = "InsufficientStockError";
  }
}

export function applyInbound(
  position: Position,
  quantityIn: DecimalInput,
  unitCostIn: DecimalInput,
): PostingResult {
  const q0 = new Decimal(position.quantity);
  const c0 = new Decimal(position.avgCost);
  const qIn = new Decimal(quantityIn);
  const cIn = new Decimal(unitCostIn);

  const newQty = q0.plus(qIn);
  // Re-average; if there was no prior stock, the new average is the inbound cost.
  const newAvg = newQty.isZero()
    ? cIn
    : q0.times(c0).plus(qIn.times(cIn)).div(newQty);

  return {
    quantity: qIn.toDecimalPlaces(DP).toString(),
    unitCost: cIn.toDecimalPlaces(DP).toString(),
    value: qIn.times(cIn).toDecimalPlaces(DP).toString(),
    balanceQty: newQty.toDecimalPlaces(DP).toString(),
    balanceAvgCost: newAvg.toDecimalPlaces(DP).toString(),
  };
}

export function applyOutbound(
  position: Position,
  quantityOut: DecimalInput,
): PostingResult {
  const q0 = new Decimal(position.quantity);
  const c0 = new Decimal(position.avgCost);
  const qOut = new Decimal(quantityOut);

  if (qOut.greaterThan(q0)) {
    throw new InsufficientStockError(q0.toString(), qOut.toString());
  }

  return {
    quantity: qOut.negated().toDecimalPlaces(DP).toString(),
    unitCost: c0.toDecimalPlaces(DP).toString(),
    value: qOut.negated().times(c0).toDecimalPlaces(DP).toString(),
    balanceQty: q0.minus(qOut).toDecimalPlaces(DP).toString(),
    balanceAvgCost: c0.toDecimalPlaces(DP).toString(),
  };
}

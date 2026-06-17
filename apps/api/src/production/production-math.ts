import Decimal from "decimal.js";
import type { DecimalInput } from "../inventory/valuation";

/**
 * Production cost roll-up: the output's unit cost is the total value of the
 * components consumed divided by the quantity produced. With this, the value
 * leaving WIP as components exactly equals the value entering as finished goods
 * (the run balances). Pure + tested.
 */
export function rollUpUnitCost(
  totalConsumedValue: DecimalInput,
  outputQty: DecimalInput,
): string {
  const qty = new Decimal(outputQty);
  if (qty.lessThanOrEqualTo(0)) {
    throw new Error("Output quantity must be greater than zero");
  }
  return new Decimal(totalConsumedValue).div(qty).toDecimalPlaces(4).toString();
}

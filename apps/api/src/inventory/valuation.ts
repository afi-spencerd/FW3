import Decimal from "decimal.js";

export type DecimalInput = string | number | Decimal;

/**
 * Pure decimal money math — no floats, ever. Uses decimal.js (the same library
 * Prisma.Decimal is built on) so 0.1 * 0.2 is exactly 0.02 and large values
 * don't lose precision. Kept free of the Prisma client so it unit-tests without
 * a database. These are the suspect-until-tested calculations.
 */
export function extendedValue(quantity: DecimalInput, unitCost: DecimalInput): string {
  return new Decimal(quantity).times(unitCost).toString();
}

export interface ValuationRow {
  quantityOnHand: DecimalInput;
  unitCost: DecimalInput;
}

export interface ValuationTotals {
  itemCount: number;
  totalQuantity: string;
  totalValue: string;
}

/** Sum quantity and extended value across rows with full decimal precision. */
export function totalValuation(rows: ValuationRow[]): ValuationTotals {
  let quantity = new Decimal(0);
  let value = new Decimal(0);
  for (const row of rows) {
    const qty = new Decimal(row.quantityOnHand);
    quantity = quantity.plus(qty);
    value = value.plus(qty.times(row.unitCost));
  }
  return {
    itemCount: rows.length,
    totalQuantity: quantity.toString(),
    totalValue: value.toString(),
  };
}

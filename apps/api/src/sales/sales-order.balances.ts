import Decimal from "decimal.js";
import { extendedValue } from "../inventory/valuation";

/**
 * Pure sales-order money math — the single source of truth for "what an order
 * owes". Both SalesOrderService (per-order DTO) and ArService (per-customer
 * receivables) compute balances through these, so the two never drift. Kept free
 * of the Prisma client: operates on the minimal structural shape below, where
 * Prisma.Decimal and string both satisfy the `.toString()` contract.
 */

interface Amountish {
  toString(): string;
}
export interface BalanceLine {
  quantityOrdered: Amountish;
  unitPrice: Amountish;
}
export interface BalanceOrder {
  status: string;
  lines: BalanceLine[];
  payments: { amount: Amountish }[];
  refunds: { amount: Amountish }[];
}

/** Σ(quantityOrdered × unitPrice) across lines. */
export function orderTotal(order: BalanceOrder): Decimal {
  return order.lines.reduce(
    (sum, l) =>
      sum.plus(new Decimal(extendedValue(l.quantityOrdered.toString(), l.unitPrice.toString()))),
    new Decimal(0),
  );
}

/** Σ recorded payment amounts (excludes convenience fees). */
export function amountPaid(order: BalanceOrder): Decimal {
  return order.payments.reduce((sum, p) => sum.plus(new Decimal(p.amount.toString())), new Decimal(0));
}

/** Σ issued refund amounts. */
export function amountRefunded(order: BalanceOrder): Decimal {
  return order.refunds.reduce((sum, r) => sum.plus(new Decimal(r.amount.toString())), new Decimal(0));
}

export interface OrderBalance {
  totalRevenue: Decimal;
  amountPaid: Decimal;
  amountRefunded: Decimal;
  /** totalRevenue − (amountPaid − amountRefunded); negative when overpaid. */
  balanceDue: Decimal;
}

export function orderBalance(order: BalanceOrder): OrderBalance {
  const totalRevenue = orderTotal(order);
  const paid = amountPaid(order);
  const refunded = amountRefunded(order);
  const balanceDue = totalRevenue.minus(paid.minus(refunded));
  return { totalRevenue, amountPaid: paid, amountRefunded: refunded, balanceDue };
}

/**
 * What can still be refunded: net payments (paid − already refunded) above what
 * the order now owes. A cancelled order owes nothing, so its whole net paid is
 * refundable; an active order is refundable only to the extent it's overpaid.
 */
export function refundableAmount(order: BalanceOrder): Decimal {
  const netPaid = amountPaid(order).minus(amountRefunded(order));
  const owed = order.status === "CANCELLED" ? new Decimal(0) : orderTotal(order);
  return Decimal.max(0, netPaid.minus(owed));
}

/**
 * Open receivable an order contributes to a customer's exposure: a cancelled
 * order owes nothing, and an overpaid order is clamped to 0 (its overpayment is
 * a refund liability, not negative AR, and must not mask another order's debt).
 */
export function openBalance(order: BalanceOrder): Decimal {
  if (order.status === "CANCELLED") return new Decimal(0);
  return Decimal.max(0, orderBalance(order).balanceDue);
}

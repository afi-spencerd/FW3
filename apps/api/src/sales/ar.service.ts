import { Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import type { ArDetail, ArOrder, ArSummaryRow, PaymentTerms } from "@fw3/shared-types";
import { PAYMENT_TERM_DAYS } from "@fw3/shared-types";
import { PrismaService } from "../database/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { orderBalance } from "./sales-order.balances";

const DAY_MS = 86_400_000;

type ArBucket = ArOrder["bucket"];

/** A customer with the non-cancelled orders needed to compute their AR position. */
type CustomerForAr = Prisma.CustomerGetPayload<{
  select: {
    id: true;
    name: true;
    creditLimit: true;
    paymentTerms: true;
    salesOrders: {
      select: {
        id: true;
        soNumber: true;
        orderDate: true;
        status: true;
        lines: { select: { quantityOrdered: true; unitPrice: true } };
        payments: { select: { amount: true } };
        refunds: { select: { amount: true } };
      };
    };
  };
}>;

const AR_CUSTOMER_SELECT = {
  id: true,
  name: true,
  creditLimit: true,
  paymentTerms: true,
  salesOrders: {
    where: { status: { not: "CANCELLED" } },
    select: {
      id: true,
      soNumber: true,
      orderDate: true,
      status: true,
      lines: { select: { quantityOrdered: true, unitPrice: true } },
      payments: { select: { amount: true } },
      refunds: { select: { amount: true } },
    },
  },
} satisfies Prisma.CustomerSelect;

/**
 * Accounts receivable, computed live from sales orders. A customer's exposure is
 * the sum of open balances across their non-cancelled orders; aging buckets each
 * order's balance by how far past its due date (orderDate + payment-term days)
 * it is. Nothing is stored — these are read-only views over the order ledger.
 */
@Injectable()
export class ArService {
  constructor(private readonly prisma: PrismaService) {}

  /** One row per customer who currently owes something, name-sorted. */
  async summary(tenantId: string): Promise<ArSummaryRow[]> {
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      select: AR_CUSTOMER_SELECT,
      orderBy: { name: "asc" },
    });
    const asOf = new Date();
    return customers
      .map((c) => this.compute(c, asOf).row)
      .filter((r) => new Decimal(r.currentExposure).greaterThan(0));
  }

  /** A single customer's AR position plus the per-order breakdown. */
  async detail(tenantId: string, customerId: string): Promise<ArDetail> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: AR_CUSTOMER_SELECT,
    });
    if (!customer) throw new NotFoundException("Customer not found");
    const { row, orders } = this.compute(customer, new Date());
    return {
      ...row,
      customerPaymentTerms: customer.paymentTerms as PaymentTerms | null,
      orders,
    };
  }

  /** Roll up one customer's open orders into a summary row + aging breakdown. */
  private compute(
    customer: CustomerForAr,
    asOf: Date,
  ): { row: ArSummaryRow; orders: ArOrder[] } {
    const termDays = PAYMENT_TERM_DAYS[customer.paymentTerms as PaymentTerms] ?? 0;
    const aging: Record<ArBucket, Decimal> = {
      current: new Decimal(0),
      d1_30: new Decimal(0),
      d31_60: new Decimal(0),
      d61_90: new Decimal(0),
      d90_plus: new Decimal(0),
    };
    let exposure = new Decimal(0);
    let oldestPastDueDays = 0;
    const orders: ArOrder[] = [];

    for (const o of customer.salesOrders) {
      const open = Decimal.max(0, orderBalance(o).balanceDue);
      if (open.lessThanOrEqualTo(0)) continue; // paid in full / overpaid
      const due = new Date(o.orderDate.getTime() + termDays * DAY_MS);
      const rawPastDue = Math.floor((asOf.getTime() - due.getTime()) / DAY_MS);
      const bucket = bucketFor(rawPastDue);
      const daysPastDue = Math.max(0, rawPastDue);
      exposure = exposure.plus(open);
      aging[bucket] = aging[bucket].plus(open);
      if (daysPastDue > oldestPastDueDays) oldestPastDueDays = daysPastDue;
      orders.push({
        salesOrderId: o.id,
        soNumber: o.soNumber,
        orderDate: o.orderDate.toISOString(),
        dueDate: due.toISOString(),
        balanceDue: open.toString(),
        bucket,
        daysPastDue,
      });
    }
    orders.sort((a, b) => a.orderDate.localeCompare(b.orderDate)); // oldest first

    const creditLimit = customer.creditLimit?.toString() ?? null;
    const availableCredit =
      creditLimit == null ? null : new Decimal(creditLimit).minus(exposure).toString();
    const row: ArSummaryRow = {
      customerId: customer.id,
      customerName: customer.name,
      creditLimit,
      currentExposure: exposure.toString(),
      availableCredit,
      aging: {
        current: aging.current.toString(),
        d1_30: aging.d1_30.toString(),
        d31_60: aging.d31_60.toString(),
        d61_90: aging.d61_90.toString(),
        d90_plus: aging.d90_plus.toString(),
      },
      openOrderCount: orders.length,
      oldestPastDueDays,
    };
    return { row, orders };
  }
}

/** Which aging bucket a balance falls in, given days past its due date. */
export function bucketFor(daysPastDue: number): ArBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d1_30";
  if (daysPastDue <= 60) return "d31_60";
  if (daysPastDue <= 90) return "d61_90";
  return "d90_plus";
}

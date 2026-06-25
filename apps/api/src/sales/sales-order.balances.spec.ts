import {
  amountPaid,
  openBalance,
  orderBalance,
  orderTotal,
  refundableAmount,
  type BalanceOrder,
} from "./sales-order.balances";

/** Build a test order from plain numbers (strings cross the wire as decimals). */
function order(partial: {
  status?: string;
  lines?: [qty: string, price: string][];
  payments?: string[];
  refunds?: string[];
}): BalanceOrder {
  return {
    status: partial.status ?? "OPEN",
    lines: (partial.lines ?? []).map(([quantityOrdered, unitPrice]) => ({
      quantityOrdered,
      unitPrice,
    })),
    payments: (partial.payments ?? []).map((amount) => ({ amount })),
    refunds: (partial.refunds ?? []).map((amount) => ({ amount })),
  };
}

describe("sales-order balances", () => {
  it("totals lines as Σ(qty × price) without float drift", () => {
    expect(orderTotal(order({ lines: [["3", "0.1"], ["1", "0.2"]] })).toString()).toBe("0.5");
  });

  it("computes balanceDue net of payments and refunds", () => {
    const o = order({ lines: [["10", "5"]], payments: ["30"], refunds: ["5"] });
    const b = orderBalance(o);
    expect(b.totalRevenue.toString()).toBe("50");
    expect(amountPaid(o).toString()).toBe("30");
    // 50 − (30 − 5) = 25
    expect(b.balanceDue.toString()).toBe("25");
  });

  it("clamps an order's open balance at 0 when overpaid", () => {
    const o = order({ lines: [["1", "100"]], payments: ["150"] });
    expect(orderBalance(o).balanceDue.toString()).toBe("-50");
    expect(openBalance(o).toString()).toBe("0");
  });

  it("treats a cancelled order as contributing no open balance", () => {
    const o = order({ status: "CANCELLED", lines: [["1", "100"]] });
    expect(openBalance(o).toString()).toBe("0");
  });

  it("counts a partially-paid order's remaining balance as exposure", () => {
    const o = order({ lines: [["1", "100"]], payments: ["40"] });
    expect(openBalance(o).toString()).toBe("60");
  });

  describe("refundableAmount", () => {
    it("is the overpaid surplus on an active order", () => {
      const o = order({ lines: [["1", "100"]], payments: ["120"] });
      expect(refundableAmount(o).toString()).toBe("20");
    });
    it("is the whole net payment on a cancelled order", () => {
      const o = order({ status: "CANCELLED", lines: [["1", "100"]], payments: ["100"] });
      expect(refundableAmount(o).toString()).toBe("100");
    });
    it("is 0 when the order is not overpaid", () => {
      const o = order({ lines: [["1", "100"]], payments: ["60"] });
      expect(refundableAmount(o).toString()).toBe("0");
    });
  });
});

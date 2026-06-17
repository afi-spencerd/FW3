import {
  applyInbound,
  applyOutbound,
  InsufficientStockError,
} from "./stock-costing";

describe("applyInbound (weighted-average)", () => {
  it("sets the average to the inbound cost when starting from zero", () => {
    const r = applyInbound({ quantity: "0", avgCost: "0" }, "100", "5");
    expect(r.balanceQty).toBe("100");
    expect(r.balanceAvgCost).toBe("5");
    expect(r.value).toBe("500");
  });

  it("re-averages against existing stock", () => {
    // 100 @ 5 + 100 @ 7 -> 200 @ 6
    const r = applyInbound({ quantity: "100", avgCost: "5" }, "100", "7");
    expect(r.balanceQty).toBe("200");
    expect(r.balanceAvgCost).toBe("6");
  });

  it("rounds the moving average to 4 dp", () => {
    // 1 @ 1 + 2 @ 2 -> 3 @ (1+4)/3 = 1.6667
    const r = applyInbound({ quantity: "1", avgCost: "1" }, "2", "2");
    expect(r.balanceQty).toBe("3");
    expect(r.balanceAvgCost).toBe("1.6667");
  });
});

describe("applyOutbound (weighted-average)", () => {
  it("costs out at the current average and leaves it unchanged", () => {
    const r = applyOutbound({ quantity: "200", avgCost: "6" }, "50");
    expect(r.quantity).toBe("-50");
    expect(r.unitCost).toBe("6");
    expect(r.value).toBe("-300");
    expect(r.balanceQty).toBe("150");
    expect(r.balanceAvgCost).toBe("6");
  });

  it("rejects taking more than is on hand (no negative inventory)", () => {
    expect(() => applyOutbound({ quantity: "10", avgCost: "5" }, "20")).toThrow(
      InsufficientStockError,
    );
  });

  it("allows taking the full quantity to zero", () => {
    const r = applyOutbound({ quantity: "10", avgCost: "5" }, "10");
    expect(r.balanceQty).toBe("0");
  });
});

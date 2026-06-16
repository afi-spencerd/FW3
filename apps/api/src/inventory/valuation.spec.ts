import { extendedValue, totalValuation } from "./valuation";

describe("extendedValue", () => {
  it("multiplies quantity by unit cost exactly", () => {
    expect(extendedValue("100", "4.5")).toBe("450");
    expect(extendedValue("25", "12.25")).toBe("306.25");
    expect(extendedValue("500", "0.085")).toBe("42.5");
    expect(extendedValue("0", "1.75")).toBe("0");
  });

  it("does not introduce floating-point error", () => {
    // 0.1 * 0.2 in JS floats is 0.020000000000000004 — decimal math gives 0.02.
    expect(extendedValue("0.1", "0.2")).toBe("0.02");
    expect(0.1 * 0.2).not.toBe(0.02); // proves the hazard we're guarding against
  });

  it("keeps precision for large values", () => {
    expect(extendedValue("1000000000.0000", "1000000.0001")).toBe(
      "1000000000100000",
    );
  });
});

describe("totalValuation", () => {
  it("rolls up the seeded inventory to an exact total", () => {
    const result = totalValuation([
      { quantityOnHand: "100", unitCost: "4.5" },
      { quantityOnHand: "25", unitCost: "12.25" },
      { quantityOnHand: "500", unitCost: "0.085" },
      { quantityOnHand: "0", unitCost: "1.75" },
    ]);
    expect(result).toEqual({
      itemCount: 4,
      totalQuantity: "625",
      totalValue: "798.75",
    });
  });

  it("returns zeroed totals for no rows", () => {
    expect(totalValuation([])).toEqual({
      itemCount: 0,
      totalQuantity: "0",
      totalValue: "0",
    });
  });
});

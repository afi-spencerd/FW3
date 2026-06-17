import { rollUpUnitCost } from "./production-math";

describe("rollUpUnitCost", () => {
  it("divides consumed value by output quantity", () => {
    expect(rollUpUnitCost("1000", "10")).toBe("100");
    expect(rollUpUnitCost("545", "100")).toBe("5.45");
  });

  it("rounds to 4 dp", () => {
    expect(rollUpUnitCost("100", "3")).toBe("33.3333");
  });

  it("rejects a non-positive output quantity", () => {
    expect(() => rollUpUnitCost("100", "0")).toThrow();
  });
});

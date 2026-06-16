import { percentagesSumTo100 } from "@fw3/shared-types";
import { requiredWeight } from "./formula-math";

describe("requiredWeight", () => {
  it("scales a percentage of the batch size", () => {
    expect(requiredWeight("10", "25")).toBe("2.5");
    expect(requiredWeight("100", "12.5")).toBe("12.5");
    expect(requiredWeight("6", "10")).toBe("0.6");
  });

  it("keeps decimal precision", () => {
    expect(requiredWeight("1", "33.3333")).toBe("0.333333");
  });

  it("explodes a full formula back to the batch size", () => {
    const batch = "10";
    const percentages = ["10", "40", "35", "15"];
    expect(percentagesSumTo100(percentages)).toBe(true);
    const total = percentages
      .map((p) => Number(requiredWeight(batch, p)))
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(10, 9);
  });
});

describe("percentagesSumTo100 (shared)", () => {
  it("is exact for fractional percentages", () => {
    expect(percentagesSumTo100(["33.3333", "33.3333", "33.3334"])).toBe(true);
    expect(percentagesSumTo100(["33.3333", "33.3333", "33.3333"])).toBe(false);
    expect(percentagesSumTo100(["50", "50"])).toBe(true);
    expect(percentagesSumTo100(["99.9999", "0.0001"])).toBe(true);
  });
});

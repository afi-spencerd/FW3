import { convertWeight, LB_PER_KG } from "./units";

describe("convertWeight", () => {
  it("is identity for the same unit", () => {
    expect(convertWeight("1.3", "LB", "LB")).toBe("1.3");
    expect(convertWeight("0.5", "KG", "KG")).toBe("0.5");
  });

  it("converts kg to lb using the business factor", () => {
    expect(convertWeight("1", "KG", "LB")).toBe(LB_PER_KG);
    expect(convertWeight("2", "KG", "LB")).toBe("4.40924524");
  });

  it("converts lb to kg", () => {
    // Exactly one kg's worth of pounds is exactly 1 kg.
    expect(convertWeight(LB_PER_KG, "LB", "KG")).toBe("1");
  });

  it("keeps decimal precision for a fractional weight", () => {
    // 1.3 lb of Ambroxan expressed in kg, then back, is within rounding of 1.3.
    const kg = convertWeight("1.3", "LB", "KG");
    const backToLb = Number(convertWeight(kg, "KG", "LB"));
    expect(backToLb).toBeCloseTo(1.3, 10);
  });
});

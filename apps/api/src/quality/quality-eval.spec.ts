import { evaluateResult } from "./quality-eval";

describe("evaluateResult", () => {
  it("passes a numeric value within range", () => {
    expect(
      evaluateResult("SPECIFIC_GRAVITY", "0.965", {
        minValue: "0.95",
        maxValue: "0.99",
        expectedValue: null,
      }),
    ).toBe(true);
  });

  it("fails a numeric value out of range (incl. Gardner color)", () => {
    const ri = { minValue: "1.45", maxValue: "1.48", expectedValue: null };
    expect(evaluateResult("REFRACTIVE_INDEX", "1.50", ri)).toBe(false);
    // Gardner color: max 5 -> a 7 reading fails (too dark).
    expect(
      evaluateResult("GARDNER_COLOR", "7", { minValue: null, maxValue: "5", expectedValue: null }),
    ).toBe(false);
    expect(
      evaluateResult("GARDNER_COLOR", "3", { minValue: null, maxValue: "5", expectedValue: null }),
    ).toBe(true);
  });

  it("evaluates melting point as a numeric range", () => {
    const mp = { minValue: "81", maxValue: "83", expectedValue: null };
    expect(evaluateResult("MELTING_POINT", "82", mp)).toBe(true);
    expect(evaluateResult("MELTING_POINT", "78", mp)).toBe(false);
  });

  it("fails a non-numeric reading for a numeric test", () => {
    expect(
      evaluateResult("SPECIFIC_GRAVITY", "pale", {
        minValue: "0.9",
        maxValue: "1.0",
        expectedValue: null,
      }),
    ).toBe(false);
  });

  it("returns null for judgment tests (odor, appearance) — set manually", () => {
    expect(evaluateResult("ODOR", "conforms", undefined)).toBeNull();
    expect(
      evaluateResult("APPEARANCE", "white crystalline powder", {
        minValue: null,
        maxValue: null,
        expectedValue: "white crystalline powder",
      }),
    ).toBeNull();
  });

  it("returns null for a numeric test with no range set", () => {
    expect(
      evaluateResult("SPECIFIC_GRAVITY", "0.97", {
        minValue: null,
        maxValue: null,
        expectedValue: null,
      }),
    ).toBeNull();
  });
});

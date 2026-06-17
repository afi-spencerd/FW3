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

  it("fails a numeric value out of range", () => {
    const spec = { minValue: "1.45", maxValue: "1.48", expectedValue: null };
    expect(evaluateResult("REFRACTIVE_INDEX", "1.50", spec)).toBe(false);
    expect(evaluateResult("REFRACTIVE_INDEX", "1.44", spec)).toBe(false);
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

  it("matches a descriptive value case-insensitively", () => {
    const spec = { minValue: null, maxValue: null, expectedValue: "Pale yellow" };
    expect(evaluateResult("COLOR", "pale yellow", spec)).toBe(true);
    expect(evaluateResult("COLOR", "amber", spec)).toBe(false);
  });

  it("returns null when no spec / no criteria (human decides)", () => {
    expect(evaluateResult("ODOR", "woody", undefined)).toBeNull();
    expect(
      evaluateResult("SPECIFIC_GRAVITY", "0.97", {
        minValue: null,
        maxValue: null,
        expectedValue: null,
      }),
    ).toBeNull();
    expect(
      evaluateResult("ODOR", "woody", {
        minValue: null,
        maxValue: null,
        expectedValue: null,
      }),
    ).toBeNull();
  });
});

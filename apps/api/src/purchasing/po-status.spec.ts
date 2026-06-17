import { poStatusFromLines } from "./po-status";

describe("poStatusFromLines", () => {
  it("is OPEN when nothing is received", () => {
    expect(
      poStatusFromLines([
        { quantityOrdered: "10", quantityReceived: "0" },
        { quantityOrdered: "5", quantityReceived: "0" },
      ]),
    ).toBe("OPEN");
  });

  it("is PARTIAL when some but not all is received", () => {
    expect(
      poStatusFromLines([
        { quantityOrdered: "10", quantityReceived: "10" },
        { quantityOrdered: "5", quantityReceived: "2" },
      ]),
    ).toBe("PARTIAL");
  });

  it("is RECEIVED only when every line is fully received", () => {
    expect(
      poStatusFromLines([
        { quantityOrdered: "10", quantityReceived: "10" },
        { quantityOrdered: "5", quantityReceived: "5" },
      ]),
    ).toBe("RECEIVED");
  });

  it("handles fractional quantities", () => {
    expect(
      poStatusFromLines([{ quantityOrdered: "1.3", quantityReceived: "1.3" }]),
    ).toBe("RECEIVED");
    expect(
      poStatusFromLines([{ quantityOrdered: "1.3", quantityReceived: "0.5" }]),
    ).toBe("PARTIAL");
  });
});

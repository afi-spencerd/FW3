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

  it("counts a within-tolerance shortfall as fully received", () => {
    // kg↔lb conversion rounding can leave a sub-unit gap; that must not strand the PO.
    expect(
      poStatusFromLines([{ quantityOrdered: "30", quantityReceived: "29.9995" }]),
    ).toBe("RECEIVED");
  });

  it("keeps a genuine shortfall PARTIAL (beyond tolerance)", () => {
    // The real PO `aaqs` Iso E Super line: 26.511 of 30 kg is a true under-receipt.
    expect(
      poStatusFromLines([{ quantityOrdered: "30", quantityReceived: "26.511" }]),
    ).toBe("PARTIAL");
  });

  it("treats an over-receipt as fully received", () => {
    expect(
      poStatusFromLines([{ quantityOrdered: "30", quantityReceived: "30.2" }]),
    ).toBe("RECEIVED");
  });
});

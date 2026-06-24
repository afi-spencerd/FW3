import { allocateLots } from "./lot-allocation";

describe("allocateLots (FIFO lot attribution)", () => {
  it("takes from a single lot that covers the quantity", () => {
    expect(allocateLots([{ lotId: "A", available: "100" }], "30")).toEqual([
      { lotId: "A", quantity: "30" },
    ]);
  });

  it("spills across lots oldest-first, splitting the last", () => {
    const out = allocateLots(
      [
        { lotId: "A", available: "10" },
        { lotId: "B", available: "10" },
        { lotId: "C", available: "10" },
      ],
      "25",
    );
    expect(out).toEqual([
      { lotId: "A", quantity: "10" },
      { lotId: "B", quantity: "10" },
      { lotId: "C", quantity: "5" },
    ]);
  });

  it("consumes a lot exactly then stops (no zero slice)", () => {
    expect(
      allocateLots(
        [
          { lotId: "A", available: "10" },
          { lotId: "B", available: "10" },
        ],
        "10",
      ),
    ).toEqual([{ lotId: "A", quantity: "10" }]);
  });

  it("adds a null remainder when lots can't cover the quantity", () => {
    expect(allocateLots([{ lotId: "A", available: "10" }], "15")).toEqual([
      { lotId: "A", quantity: "10" },
      { lotId: null, quantity: "5" },
    ]);
  });

  it("attributes the whole quantity to a null lot when there are no lots (legacy stock)", () => {
    expect(allocateLots([], "42")).toEqual([{ lotId: null, quantity: "42" }]);
  });

  it("skips depleted lots (zero/negative available)", () => {
    expect(
      allocateLots(
        [
          { lotId: "A", available: "0" },
          { lotId: "B", available: "5" },
        ],
        "3",
      ),
    ).toEqual([{ lotId: "B", quantity: "3" }]);
  });
});

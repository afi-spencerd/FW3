import { bucketFor } from "./ar.service";

describe("AR aging buckets", () => {
  it("classifies a not-yet-due balance as current (0 or negative days past due)", () => {
    expect(bucketFor(-5)).toBe("current");
    expect(bucketFor(0)).toBe("current");
  });

  it("bucket boundaries are inclusive of the upper day", () => {
    expect(bucketFor(1)).toBe("d1_30");
    expect(bucketFor(30)).toBe("d1_30");
    expect(bucketFor(31)).toBe("d31_60");
    expect(bucketFor(60)).toBe("d31_60");
    expect(bucketFor(61)).toBe("d61_90");
    expect(bucketFor(90)).toBe("d61_90");
    expect(bucketFor(91)).toBe("d90_plus");
    expect(bucketFor(365)).toBe("d90_plus");
  });
});

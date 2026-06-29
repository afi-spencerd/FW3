import { type Location, scopeLeafLocationIds } from "@fw3/shared-types";

// Minimal location tree:
//   BUILDING 075 ── AISLE A ── RACK 100, RACK 200
//                └─ AREA RECV
// plus an unrelated AISLE B ── RACK 100 under the same building.
function loc(over: Partial<Location> & Pick<Location, "id" | "kind">): Location {
  return {
    tenantId: "t",
    parentId: null,
    buildingId: null,
    name: over.id,
    segment: "",
    code: over.id,
    side: null,
    isDefault: false,
    isReceiving: false,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const building = loc({ id: "bldg", kind: "BUILDING" });
const aisleA = loc({ id: "aisleA", kind: "AISLE", parentId: "bldg", buildingId: "bldg" });
const aisleB = loc({ id: "aisleB", kind: "AISLE", parentId: "bldg", buildingId: "bldg" });
const rackA1 = loc({ id: "rackA1", kind: "RACK", parentId: "aisleA", buildingId: "bldg" });
const rackA2 = loc({ id: "rackA2", kind: "RACK", parentId: "aisleA", buildingId: "bldg" });
const rackB1 = loc({ id: "rackB1", kind: "RACK", parentId: "aisleB", buildingId: "bldg" });
const recv = loc({ id: "recv", kind: "AREA", parentId: "bldg", buildingId: "bldg" });

const all = [building, aisleA, aisleB, rackA1, rackA2, rackB1, recv];

describe("scopeLeafLocationIds", () => {
  it("returns null (no restriction) for a whole-tenant count", () => {
    expect(scopeLeafLocationIds(all, null)).toBeNull();
  });

  it("returns just itself for a leaf (RACK or AREA) scope", () => {
    expect(scopeLeafLocationIds(all, "rackA1")).toEqual(["rackA1"]);
    expect(scopeLeafLocationIds(all, "recv")).toEqual(["recv"]);
  });

  it("expands a BUILDING to all stockable leaves under it", () => {
    expect(scopeLeafLocationIds(all, "bldg")?.sort()).toEqual(
      ["rackA1", "rackA2", "rackB1", "recv"].sort(),
    );
  });

  it("expands an AISLE to only the racks directly under it", () => {
    expect(scopeLeafLocationIds(all, "aisleA")?.sort()).toEqual(
      ["rackA1", "rackA2"].sort(),
    );
    expect(scopeLeafLocationIds(all, "aisleB")).toEqual(["rackB1"]);
  });

  it("returns an empty list for an unknown scope id", () => {
    expect(scopeLeafLocationIds(all, "nope")).toEqual([]);
  });
});

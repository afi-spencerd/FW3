import {
  customerToCreateRequest,
  itemToCreateRequest,
  type ItemMasterForQb,
} from "./qb-map";

const baseItem: ItemMasterForQb = {
  sku: "RM-AMBROXAN",
  name: "Ambroxan",
  qbItemType: "INVENTORY",
  active: true,
  salesPrice: "0",
  standardCost: "210.0000",
  purchaseDescription: null,
  incomeAccount: "Sales",
  cogsAccount: "COGS",
  assetAccount: "Inventory Asset",
};

describe("itemToCreateRequest", () => {
  it("maps an inventory item — QB Name is the SKU, name is the description", () => {
    const req = itemToCreateRequest(baseItem);
    expect(req.type).toBe("Inventory");
    expect(req.name).toBe("RM-AMBROXAN");
    expect(req.salesDescription).toBe("Ambroxan");
    expect(req.purchaseCost).toBe("210.0000");
    expect(req.incomeAccountFullName).toBe("Sales");
    expect(req.assetAccountFullName).toBe("Inventory Asset");
    // Master only — never pushes quantity.
    expect(req.openingBalance).toBeUndefined();
  });

  it("maps NON_INVENTORY and SERVICE to the agent's two types", () => {
    expect(itemToCreateRequest({ ...baseItem, qbItemType: "NON_INVENTORY" }).type).toBe("NonInventory");
    expect(itemToCreateRequest({ ...baseItem, qbItemType: "SERVICE" }).type).toBe("NonInventory");
  });
});

describe("customerToCreateRequest", () => {
  it("uses the primary contact for first/last name and falls back to customer email/phone", () => {
    const req = customerToCreateRequest({
      name: "Maison Lux",
      phone: "555-2000",
      email: "buy@maisonlux.com",
      contacts: [
        { name: "Sam Junior", phone: null, email: "sam@x.com", isPrimary: false },
        { name: "Marie Cho", phone: "555-9", email: "marie@x.com", isPrimary: true },
      ],
    });
    expect(req.name).toBe("Maison Lux");
    expect(req.companyName).toBe("Maison Lux");
    expect(req.firstName).toBe("Marie");
    expect(req.lastName).toBe("Cho");
    expect(req.phone).toBe("555-2000"); // customer phone wins over contact
    expect(req.email).toBe("buy@maisonlux.com");
  });

  it("handles no contacts", () => {
    const req = customerToCreateRequest({
      name: "Acme",
      phone: null,
      email: null,
      contacts: [],
    });
    expect(req.firstName).toBeNull();
    expect(req.lastName).toBeNull();
    expect(req.phone).toBeNull();
  });
});

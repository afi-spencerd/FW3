import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildItemInventoryAddRequest,
  buildItemInventoryQueryRequest,
  parseItemInventoryQueryResponse,
} from "./qbxml";

describe("qbXML build", () => {
  it("builds an ItemInventoryQuery request", () => {
    const xml = buildItemInventoryQueryRequest();
    expect(xml).toContain('<?qbxml version="13.0"?>');
    expect(xml).toContain("<ItemInventoryQueryRq");
    expect(xml).toContain("<ActiveStatus>ActiveOnly</ActiveStatus>");
  });

  it("escapes XML-special characters and omits absent fields", () => {
    const xml = buildItemInventoryAddRequest({
      name: "Bolt & Nut <M6>",
      salesPrice: "1.50",
    });
    expect(xml).toContain("<Name>Bolt &amp; Nut &lt;M6&gt;</Name>");
    expect(xml).toContain("<SalesPrice>1.50</SalesPrice>");
    expect(xml).not.toContain("<PurchaseCost>");
  });
});

describe("qbXML parse", () => {
  it("parses a recorded multi-item response with values as strings", () => {
    const xml = readFileSync(
      join(__dirname, "__fixtures__/itemInventoryQueryResponse.xml"),
      "utf8",
    );
    const items = parseItemInventoryQueryResponse(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      listId: "80000001-1234567890",
      editSequence: "1700000000",
      name: "Standard Widget",
      quantityOnHand: "100",
      salesPrice: "9.99",
      purchaseCost: "4.50",
    });
    // Money/qty must stay strings — never coerced to float by the parser.
    expect(typeof items[0]!.quantityOnHand).toBe("string");
    expect(typeof items[0]!.salesPrice).toBe("string");
  });

  it("normalizes a single ItemInventoryRet into an array", () => {
    const xml =
      '<?xml version="1.0"?><QBXML><QBXMLMsgsRs>' +
      '<ItemInventoryQueryRs statusCode="0">' +
      "<ItemInventoryRet><ListID>L1</ListID><Name>Solo</Name></ItemInventoryRet>" +
      "</ItemInventoryQueryRs></QBXMLMsgsRs></QBXML>";
    const items = parseItemInventoryQueryResponse(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("Solo");
  });

  it("throws on a non-zero QuickBooks status code", () => {
    const xml =
      '<?xml version="1.0"?><QBXML><QBXMLMsgsRs>' +
      '<ItemInventoryQueryRs statusCode="3200" statusMessage="boom">' +
      "</ItemInventoryQueryRs></QBXMLMsgsRs></QBXML>";
    expect(() => parseItemInventoryQueryResponse(xml)).toThrow(/3200/);
  });
});

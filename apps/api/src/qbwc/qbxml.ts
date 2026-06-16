import { XMLParser } from "fast-xml-parser";

/**
 * qbXML build/parse for QuickBooks Desktop ItemInventory. These are PURE
 * functions with no SOAP/transport dependency, so they can be unit-tested
 * against recorded fixtures (the QB sync is suspect-until-tested). The SOAP /
 * Web Connector transport that carries these payloads is stubbed for now.
 */

export interface QbInventoryItem {
  listId?: string;
  editSequence?: string;
  name: string;
  quantityOnHand?: string;
  salesPrice?: string;
  purchaseCost?: string;
}

const QBXML_VERSION = "13.0";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function envelope(inner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="${QBXML_VERSION}"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
${inner}
  </QBXMLMsgsRq>
</QBXML>`;
}

/** Request all active inventory items from QuickBooks. */
export function buildItemInventoryQueryRequest(requestId = "1"): string {
  return envelope(
    `    <ItemInventoryQueryRq requestID="${escapeXml(requestId)}">
      <ActiveStatus>ActiveOnly</ActiveStatus>
    </ItemInventoryQueryRq>`,
  );
}

/** Add a new inventory item to QuickBooks. */
export function buildItemInventoryAddRequest(
  item: Pick<QbInventoryItem, "name" | "salesPrice" | "purchaseCost">,
  requestId = "1",
): string {
  const parts = [`      <Name>${escapeXml(item.name)}</Name>`];
  if (item.salesPrice !== undefined) {
    parts.push(`      <SalesPrice>${escapeXml(item.salesPrice)}</SalesPrice>`);
  }
  if (item.purchaseCost !== undefined) {
    parts.push(
      `      <PurchaseCost>${escapeXml(item.purchaseCost)}</PurchaseCost>`,
    );
  }
  return envelope(
    `    <ItemInventoryAddRq requestID="${escapeXml(requestId)}">
    <ItemInventoryAdd>
${parts.join("\n")}
    </ItemInventoryAdd>
    </ItemInventoryAddRq>`,
  );
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse an ItemInventoryQueryRs response into typed items. Throws if QuickBooks
 * reported a non-zero status code (so a failed sync never looks like an empty
 * result set).
 */
export function parseItemInventoryQueryResponse(xml: string): QbInventoryItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false, // keep numbers/money as strings — never float
  });
  const doc = parser.parse(xml) as Record<string, any>;

  const rs = doc?.QBXML?.QBXMLMsgsRs?.ItemInventoryQueryRs;
  if (!rs) {
    throw new Error("Malformed qbXML: missing ItemInventoryQueryRs");
  }
  const statusCode = String(rs["@_statusCode"] ?? "0");
  if (statusCode !== "0") {
    throw new Error(
      `QuickBooks error ${statusCode}: ${rs["@_statusMessage"] ?? "unknown"}`,
    );
  }

  return asArray(rs.ItemInventoryRet).map((ret: Record<string, any>) => ({
    listId: ret.ListID,
    editSequence: ret.EditSequence,
    name: ret.Name,
    quantityOnHand: ret.QuantityOnHand,
    salesPrice: ret.SalesPrice,
    purchaseCost: ret.PurchaseCost,
  }));
}

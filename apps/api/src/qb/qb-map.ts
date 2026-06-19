import type {
  QbCreateCustomerRequest,
  QbCreateItemRequest,
} from "./qb-agent.client";

/**
 * Pure mappers from our domain to the QuickBooks Agent request shapes. Kept
 * separate + tested. The QuickBooks item Name is our SKU (the unique code);
 * the readable name becomes the sales description. We push the item *master*
 * only — no quantity (inventory levels are not part of the master, and the
 * agent has no inventory/adjustment endpoint anyway; see the integration notes).
 */

export interface ItemMasterForQb {
  sku: string;
  name: string;
  qbItemType: string; // INVENTORY | NON_INVENTORY | SERVICE
  active: boolean;
  salesPrice: string;
  standardCost: string;
  purchaseDescription: string | null;
  incomeAccount: string | null;
  cogsAccount: string | null;
  assetAccount: string | null;
}

export function itemToCreateRequest(item: ItemMasterForQb): QbCreateItemRequest {
  // The agent only models Inventory | NonInventory; SERVICE maps to NonInventory.
  const type = item.qbItemType === "INVENTORY" ? "Inventory" : "NonInventory";
  return {
    type,
    name: item.sku,
    isActive: item.active,
    salesDescription: item.name,
    purchaseDescription: item.purchaseDescription,
    salesPrice: item.salesPrice,
    purchaseCost: item.standardCost,
    incomeAccountFullName: item.incomeAccount,
    cogsOrExpenseAccountFullName: item.cogsAccount,
    assetAccountFullName: item.assetAccount,
  };
}

export interface ContactForQb {
  name: string;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}
export interface CustomerForQb {
  name: string;
  phone: string | null;
  email: string | null;
  contacts: ContactForQb[];
}

export function customerToCreateRequest(
  customer: CustomerForQb,
): QbCreateCustomerRequest {
  const primary =
    customer.contacts.find((c) => c.isPrimary) ?? customer.contacts[0];
  const parts = (primary?.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.length ? (parts[0] ?? null) : null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return {
    name: customer.name,
    companyName: customer.name,
    firstName,
    lastName,
    phone: customer.phone ?? primary?.phone ?? null,
    email: customer.email ?? primary?.email ?? null,
  };
}

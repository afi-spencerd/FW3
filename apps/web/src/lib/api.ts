import type {
  AdjustStock,
  AuthenticatedUser,
  BatchRequirements,
  BatchRequirementsRequest,
  CreateFormula,
  CreateInventoryItem,
  CreatePurchaseOrder,
  CreateSalesOrder,
  CreateVendor,
  CreateCustomer,
  Customer,
  Formula,
  FormulaSummary,
  InventoryItem,
  CreateProductionWorkOrder,
  InventoryPosition,
  InventoryTxn,
  ItemType,
  PaginatedInventory,
  ProductionWorkOrder,
  ProductionWorkOrderSummary,
  StockPosition,
  PurchaseOrder,
  PurchaseOrderSummary,
  ReceivePurchaseOrder,
  SalesOrder,
  SalesOrderSummary,
  ShipSalesOrder,
  UpdateCustomer,
  UpdateFormula,
  UpdateInventoryItem,
  UpdateVendor,
  Vendor,
} from "@fw3/shared-types";

const BASE = "/api";

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Thrown for any non-2xx response; carries field-level issues for 400s. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body.message === "string" ? body.message : response.statusText,
      Array.isArray(body.issues) ? (body.issues as ValidationIssue[]) : undefined,
    );
  }
  return body as T;
}

export interface InventoryQuery {
  search?: string;
  itemType?: ItemType;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

function toQueryString(query: InventoryQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.itemType) params.set("itemType", query.itemType);
  if (query.active !== undefined) params.set("active", String(query.active));
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface ValuationSummary {
  itemCount: number;
  totalQuantity: string;
  totalValue: string;
}

export const api = {
  me: () => request<AuthenticatedUser>("/auth/me"),
  devLogin: (tenant: string) =>
    request<AuthenticatedUser>("/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({ tenant }),
    }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  listInventory: (query: InventoryQuery = {}) =>
    request<PaginatedInventory>(`/inventory${toQueryString(query)}`),
  getInventory: (id: string) => request<InventoryItem>(`/inventory/${id}`),
  createInventory: (data: CreateInventoryItem) =>
    request<InventoryItem>("/inventory", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateInventory: (id: string, data: UpdateInventoryItem) =>
    request<InventoryItem>(`/inventory/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteInventory: (id: string) =>
    request<void>(`/inventory/${id}`, { method: "DELETE" }),
  valuation: () => request<ValuationSummary>("/inventory/valuation"),
  stockPositions: () =>
    request<StockPosition[]>("/inventory/stock/positions"),
  itemPosition: (id: string) =>
    request<InventoryPosition>(`/inventory/${id}/position`),
  itemLedger: (id: string) =>
    request<InventoryTxn[]>(`/inventory/${id}/ledger`),
  adjustStock: (id: string, body: AdjustStock) =>
    request<InventoryPosition>(`/inventory/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  packOff: (id: string, quantity: string) =>
    request<InventoryPosition>(`/inventory/${id}/pack-off`, {
      method: "POST",
      body: JSON.stringify({ quantity }),
    }),

  listProductionWorkOrders: () =>
    request<ProductionWorkOrderSummary[]>("/production-work-orders"),
  getProductionWorkOrder: (id: string) =>
    request<ProductionWorkOrder>(`/production-work-orders/${id}`),
  createProductionWorkOrder: (data: CreateProductionWorkOrder) =>
    request<ProductionWorkOrder>("/production-work-orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  stageProductionWorkOrder: (id: string) =>
    request<ProductionWorkOrder>(`/production-work-orders/${id}/stage`, {
      method: "POST",
    }),
  completeProductionWorkOrder: (id: string) =>
    request<ProductionWorkOrder>(`/production-work-orders/${id}/complete`, {
      method: "POST",
    }),
  cancelProductionWorkOrder: (id: string) =>
    request<ProductionWorkOrder>(`/production-work-orders/${id}/cancel`, {
      method: "POST",
    }),

  listFormulas: () => request<FormulaSummary[]>("/formulas"),
  getFormula: (id: string) => request<Formula>(`/formulas/${id}`),
  createFormula: (data: CreateFormula) =>
    request<Formula>("/formulas", { method: "POST", body: JSON.stringify(data) }),
  updateFormula: (id: string, data: UpdateFormula) =>
    request<Formula>(`/formulas/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteFormula: (id: string) =>
    request<void>(`/formulas/${id}`, { method: "DELETE" }),
  formulaRequirements: (id: string, body: BatchRequirementsRequest) =>
    request<BatchRequirements>(`/formulas/${id}/requirements`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listVendors: () => request<Vendor[]>("/vendors"),
  createVendor: (data: CreateVendor) =>
    request<Vendor>("/vendors", { method: "POST", body: JSON.stringify(data) }),
  updateVendor: (id: string, data: UpdateVendor) =>
    request<Vendor>(`/vendors/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  listPurchaseOrders: () => request<PurchaseOrderSummary[]>("/purchase-orders"),
  getPurchaseOrder: (id: string) =>
    request<PurchaseOrder>(`/purchase-orders/${id}`),
  createPurchaseOrder: (data: CreatePurchaseOrder) =>
    request<PurchaseOrder>("/purchase-orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  cancelPurchaseOrder: (id: string) =>
    request<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { method: "POST" }),
  receivePurchaseOrder: (id: string, data: ReceivePurchaseOrder) =>
    request<PurchaseOrder>(`/purchase-orders/${id}/receive`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listCustomers: () => request<Customer[]>("/customers"),
  createCustomer: (data: CreateCustomer) =>
    request<Customer>("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: UpdateCustomer) =>
    request<Customer>(`/customers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  listSalesOrders: () => request<SalesOrderSummary[]>("/sales-orders"),
  getSalesOrder: (id: string) => request<SalesOrder>(`/sales-orders/${id}`),
  createSalesOrder: (data: CreateSalesOrder) =>
    request<SalesOrder>("/sales-orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  cancelSalesOrder: (id: string) =>
    request<SalesOrder>(`/sales-orders/${id}/cancel`, { method: "POST" }),
  shipSalesOrder: (id: string, data: ShipSalesOrder) =>
    request<SalesOrder>(`/sales-orders/${id}/ship`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  qbSync: () =>
    request<{ jobId: string; queued: boolean }>("/qb/sync", { method: "POST" }),
};

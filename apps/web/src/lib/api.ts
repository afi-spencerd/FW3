import type {
  AdjustContainer,
  AdjustStock,
  AuthenticatedUser,
  BusinessVariable,
  UpdateBusinessVariables,
  CompanyHoliday,
  CreateCompanyHoliday,
  UpdateCompanyHoliday,
  BatchRequirements,
  BatchRequirementsRequest,
  Container,
  ContainerTxn,
  CreateContainer,
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
  CreateLocation,
  FgRegulatory,
  FgRegulatorySummary,
  InventoryPosition,
  InventoryTxn,
  ItemLocationPosition,
  ItemQualitySpec,
  ItemType,
  CreateCycleCount,
  CycleCount,
  CycleCountStatus,
  CycleCountSummary,
  Location,
  LocationMove,
  LocationStockRow,
  Lot,
  MoveStock,
  RecordCycleCounts,
  ReturnToVendor,
  ScrapRecord,
  ScrapStock,
  VendorReturn,
  LotSummary,
  OpeningStock,
  PaginatedInventory,
  ProductionWorkOrder,
  ProductionWorkOrderSummary,
  QcLotStatus,
  RecordQualityResults,
  SetItemQualitySpecs,
  StockPosition,
  PurchaseOrder,
  PurchaseOrderSummary,
  ReceivePurchaseOrder,
  CreatePurchasingAlert,
  PurchasingAlert,
  PurchasingAlertStatus,
  CustomerItemPrice,
  ItemCost,
  SalesOrder,
  SalesOrderSummary,
  SchedulerBoard,
  ShipSalesOrder,
  UpdateSalesOrder,
  UpdateCustomer,
  UpdateFormula,
  UpdateInventoryItem,
  UpdateContainer,
  UpdateLocation,
  UpdateShipment,
  UpdateVendor,
  Vendor,
  VendorSupplySummary,
  ScrapContainer,
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
  getBusinessVariables: () => request<BusinessVariable[]>("/business-variables"),
  updateBusinessVariables: (data: UpdateBusinessVariables) =>
    request<BusinessVariable[]>("/business-variables", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getCompanyHolidays: () => request<CompanyHoliday[]>("/company-holidays"),
  createCompanyHoliday: (data: CreateCompanyHoliday) =>
    request<CompanyHoliday>("/company-holidays", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCompanyHoliday: (id: string, data: UpdateCompanyHoliday) =>
    request<CompanyHoliday>(`/company-holidays/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCompanyHoliday: (id: string) =>
    request<{ deleted: boolean }>(`/company-holidays/${id}`, { method: "DELETE" }),

  getFgRegulatory: (id: string) =>
    request<FgRegulatory>(`/inventory/${id}/regulatory`),
  refreshFgRegulatory: (id: string) =>
    request<FgRegulatory>(`/inventory/${id}/regulatory/refresh`, { method: "POST" }),
  fgRegulatorySummary: () =>
    request<FgRegulatorySummary[]>("/inventory/regulatory/summary"),

  createOpeningStock: (data: OpeningStock) =>
    request<InventoryItem>("/inventory/opening", {
      method: "POST",
      body: JSON.stringify(data),
    }),
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
  itemScraps: (id: string) => request<ScrapRecord[]>(`/inventory/${id}/scraps`),
  scrapStock: (id: string, body: ScrapStock) =>
    request<ScrapRecord>(`/inventory/${id}/scrap`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  itemLocations: (id: string) =>
    request<ItemLocationPosition[]>(`/inventory/${id}/locations`),
  itemLocationMoves: (id: string) =>
    request<LocationMove[]>(`/inventory/${id}/location-moves`),
  moveStock: (id: string, body: MoveStock) =>
    request<ItemLocationPosition[]>(`/inventory/${id}/move`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listLocations: () => request<Location[]>("/locations"),
  locationContents: (locationIds?: string[]) => {
    const qs =
      locationIds && locationIds.length
        ? "?" +
          locationIds
            .map((id) => `locationId=${encodeURIComponent(id)}`)
            .join("&")
        : "";
    return request<LocationStockRow[]>(`/locations/contents${qs}`);
  },
  createLocation: (data: CreateLocation) =>
    request<Location>("/locations", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateLocation: (id: string, data: UpdateLocation) =>
    request<Location>(`/locations/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
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

  // ---- Scheduler ----
  schedulerBoard: () => request<SchedulerBoard>("/scheduler/board"),
  enqueueWorkOrder: (id: string, position?: number) =>
    request<SchedulerBoard>(`/scheduler/work-orders/${id}/queue`, {
      method: "POST",
      body: JSON.stringify(position === undefined ? {} : { position }),
    }),
  queueByRules: (ids: string[]) =>
    request<SchedulerBoard>("/scheduler/queue-by-rules", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  repositionWorkOrder: (id: string, position: number) =>
    request<SchedulerBoard>(`/scheduler/work-orders/${id}/reposition`, {
      method: "POST",
      body: JSON.stringify({ position }),
    }),
  releaseWorkOrder: (id: string) =>
    request<SchedulerBoard>(`/scheduler/work-orders/${id}/release`, {
      method: "POST",
    }),

  // ---- Purchasing alerts ----
  listPurchasingAlerts: (status?: PurchasingAlertStatus) =>
    request<PurchasingAlert[]>(
      `/purchasing/alerts${status ? `?status=${status}` : ""}`,
    ),
  createPurchasingAlert: (data: CreatePurchasingAlert) =>
    request<PurchasingAlert>("/purchasing/alerts", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  resolvePurchasingAlert: (id: string) =>
    request<PurchasingAlert>(`/purchasing/alerts/${id}/resolve`, {
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
  vendorSupplySummary: () =>
    request<VendorSupplySummary[]>("/vendors/supply-summary"),
  getVendor: (id: string) => request<Vendor>(`/vendors/${id}`),
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
  getCustomer: (id: string) => request<Customer>(`/customers/${id}`),
  createCustomer: (data: CreateCustomer) =>
    request<Customer>("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id: string, data: UpdateCustomer) =>
    request<Customer>(`/customers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getItemCost: (id: string) => request<ItemCost>(`/inventory/${id}/cost`),
  customerPriceHistory: (customerId: string) =>
    request<CustomerItemPrice[]>(`/sales-orders/price-history/${customerId}`),
  listSalesOrders: () => request<SalesOrderSummary[]>("/sales-orders"),
  pendingShipments: () => request<SalesOrder[]>("/sales-orders/pending"),
  getSalesOrder: (id: string) => request<SalesOrder>(`/sales-orders/${id}`),
  createSalesOrder: (data: CreateSalesOrder) =>
    request<SalesOrder>("/sales-orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSalesOrder: (id: string, data: UpdateSalesOrder) =>
    request<SalesOrder>(`/sales-orders/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  cancelSalesOrder: (id: string) =>
    request<SalesOrder>(`/sales-orders/${id}/cancel`, { method: "POST" }),
  markSalesOrderPaid: (id: string) =>
    request<SalesOrder>(`/sales-orders/${id}/mark-paid`, { method: "POST" }),
  requestProduction: (id: string) =>
    request<SalesOrder>(`/sales-orders/${id}/request-production`, {
      method: "POST",
    }),
  packSalesOrder: (id: string) =>
    request<SalesOrder>(`/sales-orders/${id}/pack`, { method: "POST" }),
  shipSalesOrder: (id: string, data: ShipSalesOrder) =>
    request<SalesOrder>(`/sales-orders/${id}/ship`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateShipment: (soId: string, shipmentId: string, data: UpdateShipment) =>
    request<SalesOrder>(`/sales-orders/${soId}/shipments/${shipmentId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  listContainers: () => request<Container[]>("/containers"),
  getContainer: (id: string) => request<Container>(`/containers/${id}`),
  createContainer: (data: CreateContainer) =>
    request<Container>("/containers", { method: "POST", body: JSON.stringify(data) }),
  updateContainer: (id: string, data: UpdateContainer) =>
    request<Container>(`/containers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  adjustContainer: (id: string, data: AdjustContainer) =>
    request<Container>(`/containers/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  scrapContainer: (id: string, data: ScrapContainer) =>
    request<Container>(`/containers/${id}/scrap`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  containerTransactions: (id: string) =>
    request<ContainerTxn[]>(`/containers/${id}/transactions`),

  listCycleCounts: (status?: CycleCountStatus) =>
    request<CycleCountSummary[]>(
      `/cycle-counts${status ? `?status=${status}` : ""}`,
    ),
  getCycleCount: (id: string) => request<CycleCount>(`/cycle-counts/${id}`),
  createCycleCount: (data: CreateCycleCount) =>
    request<CycleCount>("/cycle-counts", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  recordCycleCounts: (id: string, data: RecordCycleCounts) =>
    request<CycleCount>(`/cycle-counts/${id}/counts`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  postCycleCount: (id: string) =>
    request<CycleCount>(`/cycle-counts/${id}/post`, { method: "POST" }),
  cancelCycleCount: (id: string) =>
    request<CycleCount>(`/cycle-counts/${id}/cancel`, { method: "POST" }),

  listQualityLots: (status?: QcLotStatus) =>
    request<LotSummary[]>(`/quality/lots${status ? `?status=${status}` : ""}`),
  getQualityLot: (id: string) => request<Lot>(`/quality/lots/${id}`),
  recordQualityResults: (id: string, body: RecordQualityResults) =>
    request<Lot>(`/quality/lots/${id}/results`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  approveQualityLot: (id: string) =>
    request<Lot>(`/quality/lots/${id}/approve`, { method: "POST" }),
  rejectQualityLot: (id: string, reason?: string) =>
    request<Lot>(`/quality/lots/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  returnLotToVendor: (id: string, body: ReturnToVendor) =>
    request<VendorReturn>(`/quality/lots/${id}/return`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listVendorReturns: () => request<VendorReturn[]>("/quality/returns"),
  getItemQualitySpec: (itemId: string) =>
    request<ItemQualitySpec[]>(`/quality/items/${itemId}/spec`),
  setItemQualitySpec: (itemId: string, body: SetItemQualitySpecs) =>
    request<ItemQualitySpec[]>(`/quality/items/${itemId}/spec`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  qbSync: () =>
    request<{ jobId: string; queued: boolean }>("/qb/sync", { method: "POST" }),
};

import type {
  AuthenticatedUser,
  CreateInventoryItem,
  InventoryItem,
  PaginatedInventory,
  UpdateInventoryItem,
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
  active?: boolean;
  page?: number;
  pageSize?: number;
}

function toQueryString(query: InventoryQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
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

  qbSync: () =>
    request<{ jobId: string; queued: boolean }>("/qb/sync", { method: "POST" }),
};

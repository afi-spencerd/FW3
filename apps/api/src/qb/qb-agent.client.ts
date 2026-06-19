import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";

/**
 * Typed client for the FormulaWeb QuickBooks Agent (a local REST service that
 * translates JSON ↔ QuickBooks Desktop). Authenticated with X-Api-Key; POSTs
 * carry an Idempotency-Key so replays are safe. All QuickBooks specifics stay
 * behind this client.
 */

export type QbAgentItemType = "Inventory" | "NonInventory";

export interface QbItemOpeningBalance {
  quantityOnHand: string;
  totalValue: string;
  asOf: string;
}

export interface QbCreateItemRequest {
  type: QbAgentItemType;
  name: string;
  parentFullName?: string | null;
  isActive?: boolean;
  manufacturerPartNumber?: string | null;
  salesDescription?: string | null;
  purchaseDescription?: string | null;
  salesPrice?: string | null;
  purchaseCost?: string | null;
  incomeAccountFullName?: string | null;
  cogsOrExpenseAccountFullName?: string | null;
  assetAccountFullName?: string | null;
  reorderPoint?: string | null;
  openingBalance?: QbItemOpeningBalance | null;
}

export interface QbItemDto {
  listId: string;
  editSequence: string;
  type: string;
  name: string;
  isActive?: boolean;
}

export interface QbCreateCustomerRequest {
  name: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface QbCustomerDto {
  listId: string;
  editSequence: string;
  name: string;
  isActive?: boolean;
}

export interface QbHealthResponse {
  qbReachable: boolean;
  companyFileOpen: boolean;
  companyFilePath: string | null;
  qbVersion: string | null;
  sdkVersion: string | null;
  agentVersion: string;
  mode: string;
  detail: string | null;
}

@Injectable()
export class QbAgentClient {
  private readonly logger = new Logger(QbAgentClient.name);
  private readonly baseUrl?: string;
  private readonly apiKey?: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get("QB_AGENT_URL", { infer: true });
    this.apiKey = config.get("QB_AGENT_API_KEY", { infer: true });
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  health(): Promise<QbHealthResponse> {
    return this.request<QbHealthResponse>("GET", "/health");
  }

  listItems(updatedSince?: string): Promise<QbItemDto[]> {
    return this.request<QbItemDto[]>("GET", `/items${sinceQuery(updatedSince)}`);
  }
  createItem(body: QbCreateItemRequest, idempotencyKey: string): Promise<QbItemDto> {
    return this.request<QbItemDto>("POST", "/items", { body, idempotencyKey });
  }
  getItem(listId: string): Promise<QbItemDto> {
    return this.request<QbItemDto>("GET", `/items/${encodeURIComponent(listId)}`);
  }

  listCustomers(updatedSince?: string): Promise<QbCustomerDto[]> {
    return this.request<QbCustomerDto[]>(
      "GET",
      `/customers${sinceQuery(updatedSince)}`,
    );
  }
  createCustomer(
    body: QbCreateCustomerRequest,
    idempotencyKey: string,
  ): Promise<QbCustomerDto> {
    return this.request<QbCustomerDto>("POST", "/customers", { body, idempotencyKey });
  }
  getCustomer(listId: string): Promise<QbCustomerDto> {
    return this.request<QbCustomerDto>(
      "GET",
      `/customers/${encodeURIComponent(listId)}`,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error(
        "QuickBooks agent is not configured (set QB_AGENT_URL and QB_AGENT_API_KEY)",
      );
    }
    const headers: Record<string, string> = { "X-Api-Key": this.apiKey };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const res = await fetch(new URL(path, this.baseUrl).toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      // The agent returns RFC7807 problem+json on errors.
      let detail = res.statusText;
      try {
        const problem = (await res.json()) as { title?: string; detail?: string };
        detail = problem.detail ?? problem.title ?? detail;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(`QB agent ${method} ${path} → ${res.status}: ${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

function sinceQuery(updatedSince?: string): string {
  return updatedSince ? `?updatedSince=${encodeURIComponent(updatedSince)}` : "";
}

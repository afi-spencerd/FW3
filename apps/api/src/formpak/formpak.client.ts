import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ComplianceStatus } from "@fw3/shared-types";
import type { Env } from "../config/env";

/**
 * Typed client for FormPak+, the external regulatory package (IFRA QRA, flash
 * point, allergen declaration, compliance). Authenticated with X-Api-Key.
 *
 * When FORMPAK_URL / FORMPAK_API_KEY aren't set (the default — we don't have a
 * live account), the client returns DETERMINISTIC STUB data derived from the
 * finished good, so the regulatory feature is fully usable in dev. All FormPak+
 * specifics stay behind this client.
 */

export interface FormPakComponentInput {
  sku: string;
  name: string;
  casNumber: string | null;
  effectivePercent: string;
}
export interface FormPakProfileInput {
  sku: string;
  name: string;
  components: FormPakComponentInput[];
}
export interface FormPakIfraLevelDto {
  category: string;
  maxPercent: string;
}
export interface FormPakProfileResponse {
  flashPointC: string | null;
  complianceStatus: ComplianceStatus;
  allergenDeclaration: string | null;
  certificateUrl: string | null;
  formPakRef: string | null;
  ifraLevels: FormPakIfraLevelDto[];
}

/** Stable, non-negative hash of a string (no Math.random — deterministic). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

@Injectable()
export class FormPakClient {
  private readonly logger = new Logger(FormPakClient.name);
  private readonly baseUrl?: string;
  private readonly apiKey?: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get("FORMPAK_URL", { infer: true });
    this.apiKey = config.get("FORMPAK_API_KEY", { infer: true });
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /** Fetch the FG regulatory profile — real service when configured, else stub. */
  async getRegulatoryProfile(
    input: FormPakProfileInput,
  ): Promise<FormPakProfileResponse> {
    if (!this.baseUrl || !this.apiKey) {
      return this.stubProfile(input);
    }
    const res = await fetch(new URL("/profiles", this.baseUrl).toString(), {
      method: "POST",
      headers: { "X-Api-Key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const problem = (await res.json()) as { title?: string; detail?: string };
        detail = problem.detail ?? problem.title ?? detail;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(`FormPak+ POST /profiles → ${res.status}: ${detail}`);
    }
    return (await res.json()) as FormPakProfileResponse;
  }

  /**
   * Deterministic stand-in for FormPak+ so the feature works without a live
   * account: plausible flash point, compliance, allergen declaration, and a few
   * IFRA QRA levels — all derived from the FG so they're stable across refreshes.
   */
  private stubProfile(input: FormPakProfileInput): FormPakProfileResponse {
    this.logger.debug(`FormPak+ not configured — returning stub for ${input.sku}`);
    const h = hash(input.sku);
    // Flash point in a plausible fragrance range (60–95 °C), to 1 dp.
    const flashPointC = (60 + (h % 351) / 10).toFixed(2);
    // Mostly compliant; a deterministic slice flags as pending/non-compliant.
    const compliance: ComplianceStatus =
      input.components.length === 0
        ? "UNKNOWN"
        : h % 11 === 0
          ? "NON_COMPLIANT"
          : h % 7 === 0
            ? "PENDING"
            : "COMPLIANT";
    // A representative EU Annex III allergen declaration (deterministic subset).
    const ALLERGENS = [
      "Limonene",
      "Linalool",
      "Citronellol",
      "Geraniol",
      "Eugenol",
      "Coumarin",
      "Citral",
    ];
    const picked = ALLERGENS.filter((_, i) => (h >> i) % 2 === 0).slice(0, 4);
    const allergenDeclaration = picked.length
      ? `Declared allergens (EU Annex III): ${picked.join(", ")}`
      : "No declarable allergens above threshold";
    const formPakRef = `FP-${input.sku}`;
    // A few IFRA categories with QRA max levels (deterministic per FG).
    const ifraLevels: FormPakIfraLevelDto[] = [
      { category: "4", maxPercent: (10 + (h % 200) / 10).toFixed(4) },
      { category: "5A", maxPercent: (5 + (h % 100) / 10).toFixed(4) },
      { category: "9", maxPercent: (2 + (h % 60) / 10).toFixed(4) },
    ];
    return {
      flashPointC,
      complianceStatus: compliance,
      allergenDeclaration,
      certificateUrl: `https://formpak.example/certificates/${formPakRef}`,
      formPakRef,
      ifraLevels,
    };
  }
}

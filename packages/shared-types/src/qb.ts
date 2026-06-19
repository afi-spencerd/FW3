import { z } from "zod";

/**
 * QuickBooks integration contracts (our side). The actual QB round-trip is done
 * by the external FormulaWeb QuickBooks Agent (a local REST service); these
 * shapes are what our API exposes to clients about that integration.
 */

/** Agent reachability / QuickBooks status (passthrough of the agent's /health). */
export const qbAgentHealthSchema = z.object({
  configured: z.boolean(),
  qbReachable: z.boolean(),
  companyFileOpen: z.boolean(),
  companyFilePath: z.string().nullable(),
  qbVersion: z.string().nullable(),
  agentVersion: z.string().nullable(),
  mode: z.string().nullable(),
  detail: z.string().nullable(),
});

/** Per-entity tally from a sync run. */
export const qbSyncTallySchema = z.object({
  created: z.number().int(),
  linked: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
});

export const qbSyncResultSchema = z.object({
  items: qbSyncTallySchema,
  customers: qbSyncTallySchema,
  errors: z.array(z.string()),
});

export type QbAgentHealth = z.infer<typeof qbAgentHealthSchema>;
export type QbSyncTally = z.infer<typeof qbSyncTallySchema>;
export type QbSyncResult = z.infer<typeof qbSyncResultSchema>;

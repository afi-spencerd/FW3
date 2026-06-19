import { z } from "zod";

/**
 * Validated environment. ConfigModule runs `validateEnv` at boot, so a missing
 * or malformed var fails fast with a clear message instead of surfacing as a
 * runtime null somewhere deep in the app.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(8),
  // Enables POST /auth/dev-login (local testing without Entra). Never true in prod.
  // NB: z.coerce.boolean() would turn the string "false" into true — compare explicitly.
  DEV_AUTH: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // OIDC (Entra) — optional until wired; the boundary exists now, transport later.
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().optional(),
  // FormulaWeb QuickBooks Agent (local REST → QuickBooks Desktop). Sync is
  // disabled unless both are set.
  QB_AGENT_URL: z.string().url().optional(),
  QB_AGENT_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config);
}

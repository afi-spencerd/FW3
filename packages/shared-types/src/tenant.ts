import { z } from "zod";

/**
 * Multi-tenancy is baked in from line one (hard to retrofit). Every persisted
 * row carries a tenantId; every query is scoped to the caller's tenant. The
 * slice seeds a single tenant, but nothing assumes single-tenant.
 */
export const tenantId = z.string().uuid();
export type TenantId = z.infer<typeof tenantId>;

/** Identity resolved from the OIDC session + local user/RBAC tables. */
export interface AuthenticatedUser {
  /** Local user id (PK in our users table). */
  id: string;
  /** OIDC subject claim from Entra — stable per-user identifier. */
  idpSub: string;
  email: string;
  displayName: string;
  tenantId: TenantId;
  /** Flattened, de-duplicated permission set across the user's roles. */
  permissions: string[];
}

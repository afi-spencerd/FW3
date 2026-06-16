import "express-session";

// The session holds only identifiers; the full user + permissions are resolved
// per request by AuthGuard so permission changes take effect without re-login.
declare module "express-session" {
  interface SessionData {
    userId?: string;
    tenantId?: string;
  }
}

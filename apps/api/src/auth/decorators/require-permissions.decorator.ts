import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@fw3/shared-types";

export const PERMISSIONS_KEY = "required_permissions";

/**
 * Guard an endpoint by permission(s). All listed permissions are required.
 * Used with PermissionsGuard. Guard by permission, never by role name.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

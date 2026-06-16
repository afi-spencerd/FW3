import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AuthenticatedUser, Permission } from "@fw3/shared-types";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";

/**
 * Enforces @RequirePermissions. Runs after AuthGuard (which attaches req.user).
 * Endpoints with no @RequirePermissions metadata pass through (still requires a
 * logged-in user via AuthGuard).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const granted = new Set(request.user?.permissions ?? []);
    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(", ")}`);
    }
    return true;
  }
}

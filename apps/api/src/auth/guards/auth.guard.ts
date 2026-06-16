import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "../auth.service";

/**
 * Resolves the authenticated user from the session on every request and attaches
 * it to `req.user`. Re-resolving each request means permission changes take
 * effect immediately (the session stores only ids). Throws 401 if not logged in.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const { userId, tenantId } = request.session ?? {};
    if (!userId || !tenantId) {
      throw new UnauthorizedException("Not authenticated");
    }
    const user = await this.auth.getAuthenticatedUser(tenantId, userId);
    if (!user) {
      throw new UnauthorizedException("Session user no longer valid");
    }
    (request as Request & { user: typeof user }).user = user;
    return true;
  }
}

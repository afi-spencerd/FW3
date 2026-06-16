import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedUser } from "@fw3/shared-types";

/**
 * Injects the authenticated user (resolved + attached by AuthGuard). Controllers
 * pass `user.tenantId` to services explicitly — tenant scope never comes from
 * the request body.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);

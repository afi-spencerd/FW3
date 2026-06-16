import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@fw3/shared-types";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the full user + flattened permission set for a session. Returns null
   * if the user is gone or deactivated (caller treats as 401).
   */
  async getAuthenticatedUser(
    tenantId: string,
    userId: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
      include: {
        userRoles: {
          include: {
            role: {
              include: { rolePermissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
    if (!user) return null;

    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.key),
        ),
      ),
    ];

    return {
      id: user.id,
      idpSub: user.idpSub,
      email: user.email,
      displayName: user.displayName,
      tenantId: user.tenantId,
      permissions,
    };
  }

  /**
   * Local-only login: resolve the seeded dev-admin for a tenant slug. Gated by
   * DEV_AUTH in the controller. Returns the ids to store in the session.
   */
  async devLogin(tenantSlug: string): Promise<{ userId: string; tenantId: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });
    if (!tenant) throw new NotFoundException(`Unknown tenant: ${tenantSlug}`);

    const user = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id, idpSub: "dev-admin", isActive: true },
    });
    if (!user) {
      throw new NotFoundException(
        "dev-admin user not seeded for this tenant — run `pnpm --filter @fw3/api db:seed`",
      );
    }
    return { userId: user.id, tenantId: tenant.id };
  }
}

import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { type AuthenticatedUser, PERMISSIONS } from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ArService } from "./ar.service";

/** Accounts receivable: customer balances + aging, derived from sales orders. */
@Controller("accounts-receivable")
@UseGuards(AuthGuard, PermissionsGuard)
export class ArController {
  constructor(private readonly ar: ArService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SO_READ)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.ar.summary(user.tenantId);
  }

  @Get(":customerId")
  @RequirePermissions(PERMISSIONS.SO_READ)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("customerId") customerId: string,
  ) {
    return this.ar.detail(user.tenantId, customerId);
  }
}

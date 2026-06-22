import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { type AuthenticatedUser, PERMISSIONS } from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { RegulatoryService } from "./regulatory.service";

@Controller("inventory")
@UseGuards(AuthGuard, PermissionsGuard)
export class RegulatoryController {
  constructor(private readonly regulatory: RegulatoryService) {}

  // Declared before ":id/regulatory" so the static path wins.
  @Get("regulatory/summary")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.regulatory.summary(user.tenantId);
  }

  @Get(":id/regulatory")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  getProfile(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.regulatory.getProfile(user.tenantId, id);
  }

  @Post(":id/regulatory/refresh")
  @RequirePermissions(PERMISSIONS.INVENTORY_UPDATE)
  refresh(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.regulatory.refresh(user, id);
  }
}

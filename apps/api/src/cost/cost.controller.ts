import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { type AuthenticatedUser, PERMISSIONS } from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CostService } from "./cost.service";

@Controller("inventory")
@UseGuards(AuthGuard, PermissionsGuard)
export class CostController {
  constructor(private readonly cost: CostService) {}

  // Per-lb material + production cost for an item, for sales-order pricing.
  @Get(":id/cost")
  @RequirePermissions(PERMISSIONS.SO_READ)
  itemCost(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.cost.itemCost(user.tenantId, id);
  }
}

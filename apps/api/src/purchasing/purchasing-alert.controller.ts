import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CreatePurchasingAlert,
  createPurchasingAlertSchema,
  PERMISSIONS,
  type PurchasingAlertStatus,
} from "@fw3/shared-types";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ReorderService } from "../reorder/reorder.service";
import { PurchasingAlertService } from "./purchasing-alert.service";

@Controller("purchasing")
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchasingAlertController {
  constructor(
    private readonly alerts: PurchasingAlertService,
    private readonly reorder: ReorderService,
  ) {}

  // Items/containers below their reorder point — what Purchasing should restock.
  @Get("reorder")
  @RequirePermissions(PERMISSIONS.PO_READ)
  async reorderFlags(@CurrentUser() user: AuthenticatedUser) {
    const [materials, containers] = await Promise.all([
      this.reorder.materialsBelowReorder(user.tenantId),
      this.reorder.containersBelowReorder(user.tenantId),
    ]);
    return { materials, containers };
  }

  @Get("alerts")
  @RequirePermissions(PERMISSIONS.PO_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: PurchasingAlertStatus,
  ) {
    return this.alerts.list(user.tenantId, status);
  }

  // The scheduler raises shortage alerts; gate on the scheduler permission.
  @Post("alerts")
  @RequirePermissions(PERMISSIONS.PRODUCTION_SCHEDULE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPurchasingAlertSchema))
    body: CreatePurchasingAlert,
  ) {
    return this.alerts.create(user, body);
  }

  @Post("alerts/:id/resolve")
  @RequirePermissions(PERMISSIONS.PO_UPDATE)
  resolve(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.alerts.resolve(user, id);
  }
}

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  type AdjustStock,
  adjustStockSchema,
  type AuthenticatedUser,
  type PackOff,
  packOffSchema,
  PERMISSIONS,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { StockService } from "./stock.service";

@Controller("inventory")
@UseGuards(AuthGuard, PermissionsGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** Per-(item, state) positions for the WIP vs LOT-traceable report. */
  @Get("stock/positions")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  positions(@CurrentUser() user: AuthenticatedUser) {
    return this.stock.getStockPositions(user.tenantId);
  }

  @Get(":id/position")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  position(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.stock.getPosition(user.tenantId, id);
  }

  @Get(":id/ledger")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  ledger(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.stock.getLedger(user.tenantId, id);
  }

  @Post(":id/adjust")
  @RequirePermissions(PERMISSIONS.STOCK_ADJUST)
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(adjustStockSchema)) body: AdjustStock,
  ) {
    return this.stock.adjust(user, id, body);
  }

  @Post(":id/pack-off")
  @RequirePermissions(PERMISSIONS.PRODUCTION_EXECUTE)
  packOff(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(packOffSchema)) body: PackOff,
  ) {
    return this.stock.packOff(user, id, body.quantity);
  }
}

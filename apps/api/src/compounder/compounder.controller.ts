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
  type CompounderPourInput,
  compounderPourInputSchema,
  type CompounderStatusUpdate,
  compounderStatusUpdateSchema,
  type ItemType,
  ITEM_TYPES,
  PERMISSIONS,
  type ProductionStatus,
  PRODUCTION_STATUSES,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CompounderService } from "./compounder.service";
import { compounderOpenApiDocument } from "./compounder.openapi";

/** Public: the OpenAPI contract (no auth, so tool developers can fetch it). */
@Controller("compounder")
export class CompounderDocsController {
  @Get("openapi.json")
  openapi() {
    return compounderOpenApiDocument;
  }
}

/** The compounder dosing-tool API. Reuses the authenticated user session. */
@Controller("compounder")
@UseGuards(AuthGuard, PermissionsGuard)
export class CompounderController {
  constructor(private readonly compounder: CompounderService) {}

  /** Current operator (the signed-in user). */
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.compounder.me(user);
  }

  /** Available inventory (INV + WIP), in pounds. */
  @Get("inventory")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  inventory(
    @CurrentUser() user: AuthenticatedUser,
    @Query("search") search?: string,
    @Query("itemType") itemType?: string,
  ) {
    const it =
      itemType && (ITEM_TYPES as readonly string[]).includes(itemType)
        ? (itemType as ItemType)
        : undefined;
    return this.compounder.getInventory(user.tenantId, { search, itemType: it });
  }

  @Get("work-orders")
  @RequirePermissions(PERMISSIONS.PRODUCTION_READ)
  listWorkOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
  ) {
    const s =
      status && (PRODUCTION_STATUSES as readonly string[]).includes(status)
        ? (status as ProductionStatus)
        : undefined;
    return this.compounder.listWorkOrders(user.tenantId, s);
  }

  @Get("work-orders/:id")
  @RequirePermissions(PERMISSIONS.PRODUCTION_READ)
  getWorkOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.compounder.getWorkOrder(user.tenantId, id);
  }

  @Get("work-orders/:id/pours")
  @RequirePermissions(PERMISSIONS.PRODUCTION_READ)
  listPours(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.compounder.listPours(user.tenantId, id);
  }

  /** Report a pour (consumes from WIP; operator = current user). */
  @Post("work-orders/:id/pours")
  @RequirePermissions(PERMISSIONS.PRODUCTION_EXECUTE)
  recordPour(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(compounderPourInputSchema)) body: CompounderPourInput,
  ) {
    return this.compounder.recordPour(user, id, body);
  }

  /** Start / pause / finish the batch. */
  @Post("work-orders/:id/status")
  @RequirePermissions(PERMISSIONS.PRODUCTION_EXECUTE)
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(compounderStatusUpdateSchema)) body: CompounderStatusUpdate,
  ) {
    return this.compounder.setStatus(user, id, body.status);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CreateSalesOrder,
  createSalesOrderSchema,
  PERMISSIONS,
  type ShipSalesOrder,
  shipSalesOrderSchema,
  type UpdateSalesOrder,
  updateSalesOrderSchema,
  type UpdateShipment,
  updateShipmentSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { SalesOrderService } from "./sales-order.service";

@Controller("sales-orders")
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesOrderController {
  constructor(private readonly orders: SalesOrderService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SO_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.list(user.tenantId);
  }

  // Declared before ":id" so the static path wins.
  @Get("pending")
  @RequirePermissions(PERMISSIONS.SO_READ)
  pending(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listPending(user.tenantId);
  }

  @Get("price-history/:customerId")
  @RequirePermissions(PERMISSIONS.SO_READ)
  priceHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("customerId") customerId: string,
  ) {
    return this.orders.customerPriceHistory(user.tenantId, customerId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.SO_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SO_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSalesOrderSchema)) body: CreateSalesOrder,
  ) {
    return this.orders.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.SO_UPDATE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSalesOrderSchema)) body: UpdateSalesOrder,
  ) {
    return this.orders.update(user, id, body);
  }

  @Post(":id/cancel")
  @RequirePermissions(PERMISSIONS.SO_UPDATE)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.cancel(user, id);
  }

  @Post(":id/mark-paid")
  @RequirePermissions(PERMISSIONS.SO_UPDATE)
  markPaid(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.markPaid(user, id);
  }

  @Post(":id/request-production")
  @RequirePermissions(PERMISSIONS.SO_REQUEST_PRODUCTION)
  requestProduction(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.orders.requestProduction(user, id);
  }

  @Post(":id/pack")
  @RequirePermissions(PERMISSIONS.SO_SHIP)
  pack(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.pack(user, id);
  }

  @Post(":id/ship")
  @RequirePermissions(PERMISSIONS.SO_SHIP)
  ship(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(shipSalesOrderSchema)) body: ShipSalesOrder,
  ) {
    return this.orders.ship(user, id, body);
  }

  @Put(":id/shipments/:shipmentId")
  @RequirePermissions(PERMISSIONS.SO_SHIP)
  updateShipment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("shipmentId") shipmentId: string,
    @Body(new ZodValidationPipe(updateShipmentSchema)) body: UpdateShipment,
  ) {
    return this.orders.updateShipment(user, id, shipmentId, body);
  }
}

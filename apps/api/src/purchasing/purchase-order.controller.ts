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
  type CreatePurchaseOrder,
  createPurchaseOrderSchema,
  PERMISSIONS,
  type ReceivePurchaseOrder,
  receivePurchaseOrderSchema,
  type UpdatePurchaseOrder,
  updatePurchaseOrderSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { PurchaseOrderService } from "./purchase-order.service";

@Controller("purchase-orders")
@UseGuards(AuthGuard, PermissionsGuard)
export class PurchaseOrderController {
  constructor(private readonly orders: PurchaseOrderService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PO_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.list(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PO_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PO_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema))
    body: CreatePurchaseOrder,
  ) {
    return this.orders.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.PO_UPDATE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema))
    body: UpdatePurchaseOrder,
  ) {
    return this.orders.update(user, id, body);
  }

  @Post(":id/cancel")
  @RequirePermissions(PERMISSIONS.PO_UPDATE)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.cancel(user, id);
  }

  @Post(":id/receive")
  @RequirePermissions(PERMISSIONS.PO_RECEIVE)
  receive(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(receivePurchaseOrderSchema))
    body: ReceivePurchaseOrder,
  ) {
    return this.orders.receive(user, id, body);
  }
}

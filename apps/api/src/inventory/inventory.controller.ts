import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CreateInventoryItem,
  createInventoryItemSchema,
  type InventoryListQuery,
  inventoryListQuerySchema,
  type OpeningStock,
  openingStockSchema,
  PERMISSIONS,
  type UpdateInventoryItem,
  updateInventoryItemSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { InventoryService } from "./inventory.service";

@Controller("inventory")
@UseGuards(AuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(inventoryListQuerySchema))
    query: InventoryListQuery,
  ) {
    return this.inventory.list(user.tenantId, query);
  }

  // Declared before ":id" so the static path wins.
  @Get("valuation")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  valuation(@CurrentUser() user: AuthenticatedUser) {
    return this.inventory.valuation(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.inventory.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createInventoryItemSchema))
    body: CreateInventoryItem,
  ) {
    return this.inventory.create(user, body);
  }

  // Create an item together with its opening balance (no PO needed).
  @Post("opening")
  @RequirePermissions(PERMISSIONS.INVENTORY_CREATE)
  createOpening(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(openingStockSchema)) body: OpeningStock,
  ) {
    return this.inventory.createWithOpeningBalance(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_UPDATE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateInventoryItemSchema))
    body: UpdateInventoryItem,
  ) {
    return this.inventory.update(user, id, body);
  }

  // No delete endpoint: inventory items are never hard-deleted so their
  // transactions stay auditable. Deactivate with the `active` flag instead.
}

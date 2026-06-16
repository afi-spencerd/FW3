import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.INVENTORY_DELETE)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.inventory.remove(user, id);
  }
}

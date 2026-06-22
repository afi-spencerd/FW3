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
  type AdjustContainer,
  adjustContainerSchema,
  type AuthenticatedUser,
  type CreateContainer,
  createContainerSchema,
  PERMISSIONS,
  type ScrapContainer,
  scrapContainerSchema,
  type UpdateContainer,
  updateContainerSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ContainerService } from "./container.service";

@Controller("containers")
@UseGuards(AuthGuard, PermissionsGuard)
export class ContainerController {
  constructor(private readonly containers: ContainerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.containers.list(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.containers.getById(user.tenantId, id);
  }

  @Get(":id/transactions")
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  transactions(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.containers.transactions(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createContainerSchema)) body: CreateContainer,
  ) {
    return this.containers.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_UPDATE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateContainerSchema)) body: UpdateContainer,
  ) {
    return this.containers.update(user, id, body);
  }

  @Post(":id/adjust")
  @RequirePermissions(PERMISSIONS.STOCK_ADJUST)
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(adjustContainerSchema)) body: AdjustContainer,
  ) {
    return this.containers.adjust(user, id, body);
  }

  @Post(":id/scrap")
  @RequirePermissions(PERMISSIONS.STOCK_SCRAP)
  scrap(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(scrapContainerSchema)) body: ScrapContainer,
  ) {
    return this.containers.scrap(user, id, body);
  }
}

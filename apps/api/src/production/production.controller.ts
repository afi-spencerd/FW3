import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CreateProductionRun,
  createProductionRunSchema,
  PERMISSIONS,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ProductionService } from "./production.service";

@Controller("production-runs")
@UseGuards(AuthGuard, PermissionsGuard)
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTION_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.production.list(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTION_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.production.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTION_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createProductionRunSchema)) body: CreateProductionRun,
  ) {
    return this.production.create(user, body);
  }

  @Post(":id/stage")
  @RequirePermissions(PERMISSIONS.PRODUCTION_EXECUTE)
  stage(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.production.stage(user, id);
  }

  @Post(":id/complete")
  @RequirePermissions(PERMISSIONS.PRODUCTION_EXECUTE)
  complete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.production.complete(user, id);
  }

  @Post(":id/cancel")
  @RequirePermissions(PERMISSIONS.PRODUCTION_EXECUTE)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.production.cancel(user, id);
  }
}

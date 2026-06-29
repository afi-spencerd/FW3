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
  type CreateProductionWorkOrder,
  createProductionWorkOrderSchema,
  PERMISSIONS,
  type ReassignWorkOrder,
  reassignWorkOrderSchema,
  type SetPourLocation,
  setPourLocationSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ProductionService } from "./production.service";

@Controller("production-work-orders")
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
    @Body(new ZodValidationPipe(createProductionWorkOrderSchema))
    body: CreateProductionWorkOrder,
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

  // Reassign (re-reserve) a work order to a different sales order. Audited with
  // the acting user, so who authorised the move and when is traceable.
  @Post(":id/reassign")
  @RequirePermissions(PERMISSIONS.PRODUCTION_SCHEDULE)
  reassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reassignWorkOrderSchema)) body: ReassignWorkOrder,
  ) {
    return this.production.reassign(user, id, body);
  }

  // Pour routing: recompute all line assignments from the rules, or override one.
  @Post(":id/assignments/recompute")
  @RequirePermissions(PERMISSIONS.PRODUCTION_SCHEDULE)
  recomputeAssignments(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.production.recomputeAssignments(user, id);
  }

  @Put(":id/lines/:lineId/location")
  @RequirePermissions(PERMISSIONS.PRODUCTION_SCHEDULE)
  setLineLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(setPourLocationSchema)) body: SetPourLocation,
  ) {
    return this.production.setLineLocation(user, id, lineId, body.location);
  }
}

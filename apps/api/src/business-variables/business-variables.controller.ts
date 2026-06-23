import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import {
  type AuthenticatedUser,
  PERMISSIONS,
  type UpdateBusinessVariables,
  updateBusinessVariablesSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { BusinessVariablesService } from "./business-variables.service";

@Controller("business-variables")
@UseGuards(AuthGuard, PermissionsGuard)
export class BusinessVariablesController {
  constructor(private readonly vars: BusinessVariablesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BUSINESS_VAR_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.vars.list(user.tenantId);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.BUSINESS_VAR_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateBusinessVariablesSchema))
    body: UpdateBusinessVariables,
  ) {
    return this.vars.update(user, body);
  }
}

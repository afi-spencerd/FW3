import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type BatchRequirementsRequest,
  batchRequirementsRequestSchema,
  type CreateFormula,
  createFormulaSchema,
  PERMISSIONS,
  type UpdateFormula,
  updateFormulaSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { FormulaService } from "./formula.service";

@Controller("formulas")
@UseGuards(AuthGuard, PermissionsGuard)
export class FormulaController {
  constructor(private readonly formulas: FormulaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FORMULA_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.formulas.list(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.FORMULA_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.formulas.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FORMULA_CREATE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createFormulaSchema)) body: CreateFormula,
  ) {
    return this.formulas.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.FORMULA_UPDATE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateFormulaSchema)) body: UpdateFormula,
  ) {
    return this.formulas.update(user, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.FORMULA_DELETE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.formulas.remove(user, id);
  }

  /** Scale the formula to a batch size → required quantity per raw material. */
  @Post(":id/requirements")
  @RequirePermissions(PERMISSIONS.FORMULA_READ)
  requirements(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(batchRequirementsRequestSchema))
    body: BatchRequirementsRequest,
  ) {
    return this.formulas.batchRequirements(
      user.tenantId,
      id,
      body.batchSize,
      body.unit,
    );
  }
}

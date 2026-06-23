import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CreateCompanyHoliday,
  createCompanyHolidaySchema,
  PERMISSIONS,
  type UpdateCompanyHoliday,
  updateCompanyHolidaySchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CompanyHolidaysService } from "./company-holidays.service";

// Company holidays are part of the business-variables settings area, so they
// share its permissions (read broadly; manage to adjust).
@Controller("company-holidays")
@UseGuards(AuthGuard, PermissionsGuard)
export class CompanyHolidaysController {
  constructor(private readonly holidays: CompanyHolidaysService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BUSINESS_VAR_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.holidays.list(user.tenantId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.BUSINESS_VAR_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCompanyHolidaySchema))
    body: CreateCompanyHoliday,
  ) {
    return this.holidays.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.BUSINESS_VAR_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCompanyHolidaySchema))
    body: UpdateCompanyHoliday,
  ) {
    return this.holidays.update(user, id, body);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.BUSINESS_VAR_MANAGE)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.holidays.remove(user, id);
    return { deleted: true };
  }
}

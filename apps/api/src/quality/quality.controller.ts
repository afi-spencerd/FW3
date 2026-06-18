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
  type QcLotStatus,
  PERMISSIONS,
  type RecordQualityResults,
  recordQualityResultsSchema,
  type RejectLot,
  rejectLotSchema,
  type ReturnToVendor,
  returnToVendorSchema,
  type SetItemQualitySpecs,
  setItemQualitySpecsSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { QualityService } from "./quality.service";

@Controller("quality")
@UseGuards(AuthGuard, PermissionsGuard)
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Get("lots")
  @RequirePermissions(PERMISSIONS.QC_READ)
  listLots(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: QcLotStatus,
  ) {
    return this.quality.listLots(user.tenantId, status);
  }

  @Get("lots/:id")
  @RequirePermissions(PERMISSIONS.QC_READ)
  getLot(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.quality.getLot(user.tenantId, id);
  }

  @Post("lots/:id/results")
  @RequirePermissions(PERMISSIONS.QC_REVIEW)
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(recordQualityResultsSchema)) body: RecordQualityResults,
  ) {
    return this.quality.recordResults(user, id, body);
  }

  @Post("lots/:id/approve")
  @RequirePermissions(PERMISSIONS.QC_REVIEW)
  approve(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.quality.approve(user, id);
  }

  @Post("lots/:id/reject")
  @RequirePermissions(PERMISSIONS.QC_REVIEW)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rejectLotSchema)) body: RejectLot,
  ) {
    return this.quality.reject(user, id, body.reason);
  }

  /** Return QC-failed RM to the vendor (the lot must be REJECTED). */
  @Post("lots/:id/return")
  @RequirePermissions(PERMISSIONS.VENDOR_RETURN)
  returnToVendor(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(returnToVendorSchema)) body: ReturnToVendor,
  ) {
    return this.quality.returnToVendor(user, id, body);
  }

  @Get("returns")
  @RequirePermissions(PERMISSIONS.QC_READ)
  listReturns(@CurrentUser() user: AuthenticatedUser) {
    return this.quality.listReturns(user.tenantId);
  }

  @Get("items/:itemId/spec")
  @RequirePermissions(PERMISSIONS.QC_READ)
  getSpec(@CurrentUser() user: AuthenticatedUser, @Param("itemId") itemId: string) {
    return this.quality.getItemSpecs(user.tenantId, itemId);
  }

  @Put("items/:itemId/spec")
  @RequirePermissions(PERMISSIONS.QC_SPEC_MANAGE)
  setSpec(
    @CurrentUser() user: AuthenticatedUser,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(setItemQualitySpecsSchema)) body: SetItemQualitySpecs,
  ) {
    return this.quality.setItemSpecs(user, itemId, body);
  }
}

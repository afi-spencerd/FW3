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
  type CreateVendor,
  createVendorSchema,
  PERMISSIONS,
  type UpdateVendor,
  updateVendorSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { VendorService } from "./vendor.service";

@Controller("vendors")
@UseGuards(AuthGuard, PermissionsGuard)
export class VendorController {
  constructor(private readonly vendors: VendorService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VENDOR_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.vendors.list(user.tenantId);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.VENDOR_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.vendors.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VENDOR_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createVendorSchema)) body: CreateVendor,
  ) {
    return this.vendors.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.VENDOR_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateVendorSchema)) body: UpdateVendor,
  ) {
    return this.vendors.update(user, id, body);
  }
}

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
  type CreateLocation,
  createLocationSchema,
  PERMISSIONS,
  type UpdateLocation,
  updateLocationSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { LocationService } from "./location.service";

@Controller("locations")
@UseGuards(AuthGuard, PermissionsGuard)
export class LocationController {
  constructor(private readonly locations: LocationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LOCATION_READ)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.locations.list(user.tenantId);
  }

  /**
   * What's currently in the given location(s). Pass `locationId` one or more
   * times to filter; omit for every location. Located stock only.
   */
  @Get("contents")
  @RequirePermissions(PERMISSIONS.LOCATION_READ)
  contents(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locationId") locationId?: string | string[],
  ) {
    const ids =
      locationId === undefined
        ? undefined
        : Array.isArray(locationId)
          ? locationId
          : [locationId];
    return this.locations.getContents(user.tenantId, ids);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LOCATION_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createLocationSchema)) body: CreateLocation,
  ) {
    return this.locations.create(user, body);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.LOCATION_MANAGE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocation,
  ) {
    return this.locations.update(user, id, body);
  }
}

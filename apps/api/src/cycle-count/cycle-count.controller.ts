import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  type CreateCycleCount,
  createCycleCountSchema,
  CYCLE_COUNT_STATUSES,
  type CycleCountStatus,
  PERMISSIONS,
  type RecordCycleCounts,
  recordCycleCountsSchema,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CycleCountService } from "./cycle-count.service";

@Controller("cycle-counts")
@UseGuards(AuthGuard, PermissionsGuard)
export class CycleCountController {
  constructor(private readonly cycleCounts: CycleCountService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_READ)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("status") status?: string,
  ) {
    const s =
      status && (CYCLE_COUNT_STATUSES as readonly string[]).includes(status)
        ? (status as CycleCountStatus)
        : undefined;
    return this.cycleCounts.list(user.tenantId, s);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_READ)
  getById(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.cycleCounts.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_MANAGE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCycleCountSchema)) body: CreateCycleCount,
  ) {
    return this.cycleCounts.create(user, body);
  }

  @Post(":id/counts")
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_MANAGE)
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(recordCycleCountsSchema)) body: RecordCycleCounts,
  ) {
    return this.cycleCounts.recordCounts(user, id, body);
  }

  @Post(":id/post")
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_MANAGE)
  post(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.cycleCounts.post(user, id);
  }

  @Post(":id/cancel")
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_MANAGE)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.cycleCounts.cancel(user, id);
  }
}

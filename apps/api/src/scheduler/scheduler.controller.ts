import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  type AuthenticatedUser,
  type EnqueueWorkOrder,
  enqueueWorkOrderSchema,
  PERMISSIONS,
  type QueueByRules,
  queueByRulesSchema,
  type RepositionWorkOrder,
  repositionWorkOrderSchema,
} from "@fw3/shared-types";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SchedulerService } from "./scheduler.service";

@Controller("scheduler")
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.PRODUCTION_SCHEDULE)
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get("board")
  board(@CurrentUser() user: AuthenticatedUser) {
    return this.scheduler.board(user.tenantId);
  }

  @Post("work-orders/:id/queue")
  enqueue(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(enqueueWorkOrderSchema)) body: EnqueueWorkOrder,
  ) {
    return this.scheduler.enqueue(user, id, body.position);
  }

  @Post("queue-by-rules")
  queueByRules(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(queueByRulesSchema)) body: QueueByRules,
  ) {
    return this.scheduler.queueByRules(user, body.ids);
  }

  @Post("work-orders/:id/reposition")
  reposition(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(repositionWorkOrderSchema)) body: RepositionWorkOrder,
  ) {
    return this.scheduler.reposition(user, id, body.position);
  }

  @Post("work-orders/:id/release")
  release(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.scheduler.release(user, id);
  }

  @Post("release-all")
  releaseAll(@CurrentUser() user: AuthenticatedUser) {
    return this.scheduler.releaseAll(user);
  }
}

import { Controller, Inject, Post, UseGuards } from "@nestjs/common";
import { Queue } from "bullmq";
import { type AuthenticatedUser, PERMISSIONS } from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { QB_SYNC_QUEUE, type QbSyncJobData } from "./jobs.constants";

@Controller("qb")
@UseGuards(AuthGuard, PermissionsGuard)
export class JobsController {
  constructor(
    @Inject(QB_SYNC_QUEUE) private readonly queue: Queue<QbSyncJobData>,
  ) {}

  /** Enqueue a QuickBooks item sync. Returns immediately — work runs in the worker. */
  @Post("sync")
  @RequirePermissions(PERMISSIONS.QB_SYNC_RUN)
  async sync(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ jobId: string | undefined; queued: true }> {
    const job = await this.queue.add("item-sync", { tenantId: user.tenantId });
    return { jobId: job.id, queued: true };
  }
}

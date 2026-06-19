import { Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { Queue } from "bullmq";
import {
  type AuthenticatedUser,
  PERMISSIONS,
  type QbAgentHealth,
} from "@fw3/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { AuthGuard } from "../auth/guards/auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { QbSyncService } from "../qb/qb-sync.service";
import { QB_SYNC_QUEUE, type QbSyncJobData } from "./jobs.constants";

@Controller("qb")
@UseGuards(AuthGuard, PermissionsGuard)
export class JobsController {
  constructor(
    @Inject(QB_SYNC_QUEUE) private readonly queue: Queue<QbSyncJobData>,
    private readonly qbSync: QbSyncService,
  ) {}

  /** Agent reachability + QuickBooks status. */
  @Get("health")
  @RequirePermissions(PERMISSIONS.QB_SYNC_VIEW)
  health(): Promise<QbAgentHealth> {
    return this.qbSync.health();
  }

  /** Enqueue a QuickBooks sync (items + customers). Returns immediately — work runs in the worker. */
  @Post("sync")
  @RequirePermissions(PERMISSIONS.QB_SYNC_RUN)
  async sync(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ jobId: string | undefined; queued: true }> {
    const job = await this.queue.add("item-sync", { tenantId: user.tenantId });
    return { jobId: job.id, queued: true };
  }
}

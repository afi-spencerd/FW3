import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type Job, Worker } from "bullmq";
import type { Env } from "../config/env";
import { redisConnectionOptions } from "../redis/redis-options";
import { QbwcService } from "../qbwc/qbwc.service";
import { QB_SYNC_QUEUE_NAME, type QbSyncJobData } from "./jobs.constants";

/**
 * BullMQ worker for QuickBooks sync. Heavy/long QB work runs here, off the
 * triggering HTTP request. Uses its own Redis connection (BullMQ blocks on the
 * worker connection, so it must not share the request-path client).
 */
@Injectable()
export class QbSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QbSyncWorker.name);
  private worker?: Worker<QbSyncJobData>;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly qbwc: QbwcService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<QbSyncJobData>(
      QB_SYNC_QUEUE_NAME,
      async (job: Job<QbSyncJobData>) => {
        this.logger.log(`Processing qb-sync job ${job.id} for tenant ${job.data.tenantId}`);
        return this.qbwc.requestItemSync(job.data.tenantId);
      },
      {
        connection: redisConnectionOptions(
          this.config.get("REDIS_URL", { infer: true }),
        ),
      },
    );
    this.worker.on("failed", (job, err) =>
      this.logger.error(`qb-sync job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

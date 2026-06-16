import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import type { Env } from "../config/env";
import { redisConnectionOptions } from "../redis/redis-options";
import { QbwcModule } from "../qbwc/qbwc.module";
import { JobsController } from "./jobs.controller";
import { QB_SYNC_QUEUE, QB_SYNC_QUEUE_NAME } from "./jobs.constants";
import { QbSyncWorker } from "./qb-sync.worker";

@Module({
  imports: [QbwcModule],
  controllers: [JobsController],
  providers: [
    {
      provide: QB_SYNC_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Queue(QB_SYNC_QUEUE_NAME, {
          connection: redisConnectionOptions(
            config.get("REDIS_URL", { infer: true }),
          ),
        }),
    },
    QbSyncWorker,
  ],
  exports: [QB_SYNC_QUEUE],
})
export class JobsModule {}

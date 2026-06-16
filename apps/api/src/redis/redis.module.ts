import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import IORedis from "ioredis";
import type { Env } from "../config/env";

/** DI token for the shared ioredis connection (session store + BullMQ). */
export const REDIS = "REDIS_CLIENT";

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        // maxRetriesPerRequest: null is required by BullMQ on the shared client.
        new IORedis(config.get("REDIS_URL", { infer: true }), {
          maxRetriesPerRequest: null,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

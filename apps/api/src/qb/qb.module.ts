import { Module } from "@nestjs/common";
import { QbAgentClient } from "./qb-agent.client";
import { QbSyncService } from "./qb-sync.service";

@Module({
  providers: [QbAgentClient, QbSyncService],
  exports: [QbSyncService],
})
export class QbModule {}

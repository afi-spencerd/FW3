import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { DatabaseModule } from "./database/database.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { InventoryModule } from "./inventory/inventory.module";
import { StockModule } from "./stock/stock.module";
import { FormulaModule } from "./formula/formula.module";
import { PurchasingModule } from "./purchasing/purchasing.module";
import { QbwcModule } from "./qbwc/qbwc.module";
import { JobsModule } from "./jobs/jobs.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // Repo-root .env (cwd is apps/api at runtime); also honor a local one.
      envFilePath: ["../../.env", ".env"],
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    AuditModule,
    InventoryModule,
    StockModule,
    FormulaModule,
    PurchasingModule,
    QbwcModule,
    JobsModule,
  ],
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env";
import { DatabaseModule } from "./database/database.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { InventoryModule } from "./inventory/inventory.module";
import { StockModule } from "./stock/stock.module";
import { LocationModule } from "./location/location.module";
import { FormulaModule } from "./formula/formula.module";
import { PurchasingModule } from "./purchasing/purchasing.module";
import { SalesModule } from "./sales/sales.module";
import { ProductionModule } from "./production/production.module";
import { CompounderModule } from "./compounder/compounder.module";
import { QualityModule } from "./quality/quality.module";
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
    LocationModule,
    FormulaModule,
    PurchasingModule,
    SalesModule,
    ProductionModule,
    CompounderModule,
    QualityModule,
    QbwcModule,
    JobsModule,
  ],
})
export class AppModule {}

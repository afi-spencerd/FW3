import { Global, Module } from "@nestjs/common";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";

/**
 * Global so document modules (purchasing, production, sales) can inject
 * StockService.post — the single ledger choke point.
 */
@Global()
@Module({
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}

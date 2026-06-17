import { Module } from "@nestjs/common";
import { FormulaModule } from "../formula/formula.module";
import { ProductionController } from "./production.controller";
import { ProductionService } from "./production.service";

@Module({
  imports: [FormulaModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}

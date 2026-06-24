import { Module } from "@nestjs/common";
import { FormulaModule } from "../formula/formula.module";
import { BusinessVariablesModule } from "../business-variables/business-variables.module";
import { RobotModule } from "../robot/robot.module";
import { ProductionController } from "./production.controller";
import { ProductionService } from "./production.service";

@Module({
  imports: [FormulaModule, BusinessVariablesModule, RobotModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}

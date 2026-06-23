import { Module } from "@nestjs/common";
import { BusinessVariablesModule } from "../business-variables/business-variables.module";
import { CostController } from "./cost.controller";
import { CostService } from "./cost.service";

@Module({
  imports: [BusinessVariablesModule],
  controllers: [CostController],
  providers: [CostService],
  exports: [CostService],
})
export class CostModule {}

import { Module } from "@nestjs/common";
import { BusinessVariablesController } from "./business-variables.controller";
import { BusinessVariablesService } from "./business-variables.service";

@Module({
  controllers: [BusinessVariablesController],
  providers: [BusinessVariablesService],
  exports: [BusinessVariablesService],
})
export class BusinessVariablesModule {}

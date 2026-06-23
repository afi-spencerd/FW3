import { Module } from "@nestjs/common";
import { BusinessVariablesModule } from "../business-variables/business-variables.module";
import { ReorderModule } from "../reorder/reorder.module";
import { SchedulerController } from "./scheduler.controller";
import { SchedulerService } from "./scheduler.service";

@Module({
  imports: [BusinessVariablesModule, ReorderModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}

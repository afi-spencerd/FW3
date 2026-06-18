import { Module } from "@nestjs/common";
import { CycleCountController } from "./cycle-count.controller";
import { CycleCountService } from "./cycle-count.service";

@Module({
  controllers: [CycleCountController],
  providers: [CycleCountService],
})
export class CycleCountModule {}

import { Module } from "@nestjs/common";
import { RobotController } from "./robot.controller";
import { RobotService } from "./robot.service";

@Module({
  controllers: [RobotController],
  providers: [RobotService],
  exports: [RobotService],
})
export class RobotModule {}

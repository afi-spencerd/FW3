import { Module } from "@nestjs/common";
import { FormpakModule } from "../formpak/formpak.module";
import { RegulatoryController } from "./regulatory.controller";
import { RegulatoryService } from "./regulatory.service";

@Module({
  imports: [FormpakModule],
  controllers: [RegulatoryController],
  providers: [RegulatoryService],
  exports: [RegulatoryService],
})
export class RegulatoryModule {}

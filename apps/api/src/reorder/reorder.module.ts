import { Module } from "@nestjs/common";
import { ReorderService } from "./reorder.service";

@Module({
  providers: [ReorderService],
  exports: [ReorderService],
})
export class ReorderModule {}

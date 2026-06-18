import { Module } from "@nestjs/common";
import { ProductionModule } from "../production/production.module";
import {
  CompounderController,
  CompounderDocsController,
} from "./compounder.controller";
import { CompounderService } from "./compounder.service";

@Module({
  imports: [ProductionModule],
  controllers: [CompounderDocsController, CompounderController],
  providers: [CompounderService],
})
export class CompounderModule {}

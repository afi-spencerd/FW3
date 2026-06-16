import { Module } from "@nestjs/common";
import { QbwcService } from "./qbwc.service";

/**
 * Sealed QuickBooks integration boundary. When the SOAP transport is built it
 * lands inside this module; the rest of the app only ever sees QbwcService.
 */
@Module({
  providers: [QbwcService],
  exports: [QbwcService],
})
export class QbwcModule {}

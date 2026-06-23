import { Module } from "@nestjs/common";
import { CompanyHolidaysController } from "./company-holidays.controller";
import { CompanyHolidaysService } from "./company-holidays.service";

@Module({
  controllers: [CompanyHolidaysController],
  providers: [CompanyHolidaysService],
  exports: [CompanyHolidaysService],
})
export class CompanyHolidaysModule {}

import { Module } from "@nestjs/common";
import { CustomerController } from "./customer.controller";
import { CustomerService } from "./customer.service";
import { SalesOrderController } from "./sales-order.controller";
import { SalesOrderService } from "./sales-order.service";

@Module({
  controllers: [CustomerController, SalesOrderController],
  providers: [CustomerService, SalesOrderService],
  exports: [CustomerService, SalesOrderService],
})
export class SalesModule {}

import { Module } from "@nestjs/common";
import { ContainerModule } from "../container/container.module";
import { CostModule } from "../cost/cost.module";
import { CustomerController } from "./customer.controller";
import { CustomerService } from "./customer.service";
import { SalesOrderController } from "./sales-order.controller";
import { SalesOrderService } from "./sales-order.service";

@Module({
  imports: [ContainerModule, CostModule],
  controllers: [CustomerController, SalesOrderController],
  providers: [CustomerService, SalesOrderService],
  exports: [CustomerService, SalesOrderService],
})
export class SalesModule {}

import { Module } from "@nestjs/common";
import { BusinessVariablesModule } from "../business-variables/business-variables.module";
import { ContainerModule } from "../container/container.module";
import { CostModule } from "../cost/cost.module";
import { FormulaModule } from "../formula/formula.module";
import { ArController } from "./ar.controller";
import { ArService } from "./ar.service";
import { CustomerController } from "./customer.controller";
import { CustomerService } from "./customer.service";
import { SalesOrderController } from "./sales-order.controller";
import { SalesOrderService } from "./sales-order.service";

@Module({
  imports: [ContainerModule, CostModule, FormulaModule, BusinessVariablesModule],
  controllers: [CustomerController, SalesOrderController, ArController],
  providers: [CustomerService, SalesOrderService, ArService],
  exports: [CustomerService, SalesOrderService],
})
export class SalesModule {}

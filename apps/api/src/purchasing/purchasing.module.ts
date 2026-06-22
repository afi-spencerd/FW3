import { Module } from "@nestjs/common";
import { ContainerModule } from "../container/container.module";
import { VendorController } from "./vendor.controller";
import { VendorService } from "./vendor.service";
import { PurchaseOrderController } from "./purchase-order.controller";
import { PurchaseOrderService } from "./purchase-order.service";

@Module({
  imports: [ContainerModule],
  controllers: [VendorController, PurchaseOrderController],
  providers: [VendorService, PurchaseOrderService],
  exports: [VendorService, PurchaseOrderService],
})
export class PurchasingModule {}

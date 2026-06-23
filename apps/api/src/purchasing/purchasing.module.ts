import { Module } from "@nestjs/common";
import { ContainerModule } from "../container/container.module";
import { ReorderModule } from "../reorder/reorder.module";
import { VendorController } from "./vendor.controller";
import { VendorService } from "./vendor.service";
import { PurchaseOrderController } from "./purchase-order.controller";
import { PurchaseOrderService } from "./purchase-order.service";
import { PurchasingAlertController } from "./purchasing-alert.controller";
import { PurchasingAlertService } from "./purchasing-alert.service";

@Module({
  imports: [ContainerModule, ReorderModule],
  controllers: [
    VendorController,
    PurchaseOrderController,
    PurchasingAlertController,
  ],
  providers: [VendorService, PurchaseOrderService, PurchasingAlertService],
  exports: [VendorService, PurchaseOrderService, PurchasingAlertService],
})
export class PurchasingModule {}

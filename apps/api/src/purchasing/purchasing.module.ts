import { Module } from "@nestjs/common";
import { VendorController } from "./vendor.controller";
import { VendorService } from "./vendor.service";
import { PurchaseOrderController } from "./purchase-order.controller";
import { PurchaseOrderService } from "./purchase-order.service";

@Module({
  controllers: [VendorController, PurchaseOrderController],
  providers: [VendorService, PurchaseOrderService],
  exports: [VendorService, PurchaseOrderService],
})
export class PurchasingModule {}

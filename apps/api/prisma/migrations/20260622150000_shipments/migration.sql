BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Shipment] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [salesOrderId] CHAR(36) NOT NULL,
    [shipmentNumber] NVARCHAR(60) NOT NULL,
    [carrier] NVARCHAR(100),
    [trackingNumber] NVARCHAR(120),
    [notes] NVARCHAR(500),
    [shippedById] CHAR(36) NOT NULL,
    [shippedAt] DATETIME2 NOT NULL CONSTRAINT [Shipment_shippedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Shipment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Shipment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ShipmentLine] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [shipmentId] CHAR(36) NOT NULL,
    [salesOrderLineId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL,
    [unitCost] DECIMAL(19,4) NOT NULL,
    [value] DECIMAL(38,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShipmentLine_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ShipmentLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [Shipment_tenantId_shipmentNumber_key] ON [dbo].[Shipment]([tenantId], [shipmentNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Shipment_tenantId_idx] ON [dbo].[Shipment]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Shipment_salesOrderId_idx] ON [dbo].[Shipment]([salesOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShipmentLine_tenantId_idx] ON [dbo].[ShipmentLine]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ShipmentLine_shipmentId_idx] ON [dbo].[ShipmentLine]([shipmentId]);

-- AddForeignKey
ALTER TABLE [dbo].[Shipment] ADD CONSTRAINT [Shipment_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Shipment] ADD CONSTRAINT [Shipment_salesOrderId_fkey] FOREIGN KEY ([salesOrderId]) REFERENCES [dbo].[SalesOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Shipment] ADD CONSTRAINT [Shipment_shippedById_fkey] FOREIGN KEY ([shippedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShipmentLine] ADD CONSTRAINT [ShipmentLine_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShipmentLine] ADD CONSTRAINT [ShipmentLine_shipmentId_fkey] FOREIGN KEY ([shipmentId]) REFERENCES [dbo].[Shipment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShipmentLine] ADD CONSTRAINT [ShipmentLine_salesOrderLineId_fkey] FOREIGN KEY ([salesOrderLineId]) REFERENCES [dbo].[SalesOrderLine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ShipmentLine] ADD CONSTRAINT [ShipmentLine_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[ReceivedLot] ADD [returnedQty] DECIMAL(18,4) NOT NULL CONSTRAINT [ReceivedLot_returnedQty_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[VendorReturn] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [receivedLotId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [vendorName] NVARCHAR(200),
    [purchaseOrderNumber] NVARCHAR(50),
    [quantity] DECIMAL(18,4) NOT NULL,
    [unitCost] DECIMAL(19,4) NOT NULL,
    [value] DECIMAL(38,4) NOT NULL,
    [reason] NVARCHAR(500),
    [rmaNumber] NVARCHAR(50),
    [note] NVARCHAR(500),
    [operatorId] CHAR(36) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [VendorReturn_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [VendorReturn_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [VendorReturn_tenantId_occurredAt_idx] ON [dbo].[VendorReturn]([tenantId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [VendorReturn_receivedLotId_idx] ON [dbo].[VendorReturn]([receivedLotId]);

-- AddForeignKey
ALTER TABLE [dbo].[VendorReturn] ADD CONSTRAINT [VendorReturn_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VendorReturn] ADD CONSTRAINT [VendorReturn_receivedLotId_fkey] FOREIGN KEY ([receivedLotId]) REFERENCES [dbo].[ReceivedLot]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VendorReturn] ADD CONSTRAINT [VendorReturn_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VendorReturn] ADD CONSTRAINT [VendorReturn_operatorId_fkey] FOREIGN KEY ([operatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A QC-failed lot can now also be RETURNED (to the vendor).
ALTER TABLE [dbo].[ReceivedLot] DROP CONSTRAINT [ReceivedLot_qcStatus_allowed];
ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_qcStatus_allowed] CHECK ([qcStatus] IN ('PENDING', 'APPROVED', 'REJECTED', 'RETURNED'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

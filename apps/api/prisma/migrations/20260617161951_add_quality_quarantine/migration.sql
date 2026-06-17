BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ItemQualitySpec] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [testType] NVARCHAR(30) NOT NULL,
    [minValue] DECIMAL(18,6),
    [maxValue] DECIMAL(18,6),
    [expectedValue] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ItemQualitySpec_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ItemQualitySpec_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ItemQualitySpec_itemId_testType_key] UNIQUE NONCLUSTERED ([itemId],[testType])
);

-- CreateTable
CREATE TABLE [dbo].[ReceivedLot] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [purchaseOrderId] CHAR(36),
    [purchaseOrderLineId] CHAR(36),
    [purchaseOrderNumber] NVARCHAR(50),
    [vendorName] NVARCHAR(200),
    [supplierLotNumber] NVARCHAR(80) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL,
    [unitCost] DECIMAL(19,4) NOT NULL,
    [qcStatus] NVARCHAR(20) NOT NULL CONSTRAINT [ReceivedLot_qcStatus_df] DEFAULT 'PENDING',
    [rejectionReason] NVARCHAR(500),
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [ReceivedLot_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [reviewedAt] DATETIME2,
    [reviewedById] CHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ReceivedLot_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ReceivedLot_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[QualityTestResult] (
    [id] CHAR(36) NOT NULL,
    [receivedLotId] CHAR(36) NOT NULL,
    [testType] NVARCHAR(30) NOT NULL,
    [measuredValue] NVARCHAR(200),
    [passed] BIT,
    [notes] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QualityTestResult_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [QualityTestResult_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QualityTestResult_receivedLotId_testType_key] UNIQUE NONCLUSTERED ([receivedLotId],[testType])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ItemQualitySpec_tenantId_idx] ON [dbo].[ItemQualitySpec]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReceivedLot_tenantId_qcStatus_idx] ON [dbo].[ReceivedLot]([tenantId], [qcStatus]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReceivedLot_itemId_idx] ON [dbo].[ReceivedLot]([itemId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [QualityTestResult_receivedLotId_idx] ON [dbo].[QualityTestResult]([receivedLotId]);

-- AddForeignKey
ALTER TABLE [dbo].[ItemQualitySpec] ADD CONSTRAINT [ItemQualitySpec_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ItemQualitySpec] ADD CONSTRAINT [ItemQualitySpec_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[QualityTestResult] ADD CONSTRAINT [QualityTestResult_receivedLotId_fkey] FOREIGN KEY ([receivedLotId]) REFERENCES [dbo].[ReceivedLot]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Allow the new QUARANTINE bucket on the stock status CHECKs (existing tables).
ALTER TABLE [dbo].[InventoryTxn] DROP CONSTRAINT [InventoryTxn_state_allowed];
ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_state_allowed] CHECK ([state] IN ('INV', 'WIP', 'QUARANTINE'));
ALTER TABLE [dbo].[ItemStock] DROP CONSTRAINT [ItemStock_state_allowed];
ALTER TABLE [dbo].[ItemStock] ADD CONSTRAINT [ItemStock_state_allowed] CHECK ([state] IN ('INV', 'WIP', 'QUARANTINE'));

-- New-table guardrails (EXEC()'d — tables created in this batch).
EXEC('ALTER TABLE [dbo].[ItemQualitySpec] ADD CONSTRAINT [ItemQualitySpec_testType_allowed] CHECK ([testType] IN (''SPECIFIC_GRAVITY'', ''REFRACTIVE_INDEX'', ''COLOR'', ''ODOR''))');
EXEC('ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_qcStatus_allowed] CHECK ([qcStatus] IN (''PENDING'', ''APPROVED'', ''REJECTED''))');
EXEC('ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_quantity_pos] CHECK ([quantity] > 0)');
EXEC('ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_unitCost_nonneg] CHECK ([unitCost] >= 0)');
EXEC('ALTER TABLE [dbo].[QualityTestResult] ADD CONSTRAINT [QualityTestResult_testType_allowed] CHECK ([testType] IN (''SPECIFIC_GRAVITY'', ''REFRACTIVE_INDEX'', ''COLOR'', ''ODOR''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

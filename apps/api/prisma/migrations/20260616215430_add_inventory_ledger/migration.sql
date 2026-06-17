BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[InventoryTxn] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [type] NVARCHAR(30) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL,
    [unitCost] DECIMAL(19,4) NOT NULL,
    [value] DECIMAL(38,4) NOT NULL,
    [balanceQty] DECIMAL(38,4) NOT NULL,
    [balanceAvgCost] DECIMAL(19,4) NOT NULL,
    [docType] NVARCHAR(30),
    [docId] CHAR(36),
    [note] NVARCHAR(500),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [InventoryTxn_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InventoryTxn_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryTxn_tenantId_itemId_occurredAt_idx] ON [dbo].[InventoryTxn]([tenantId], [itemId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryTxn_tenantId_docType_docId_idx] ON [dbo].[InventoryTxn]([tenantId], [docType], [docId]);

-- AddForeignKey
ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Financial-safety guardrails at the DB level: cost is never negative, and the
-- running balance can never go negative (no negative inventory). EXEC() runs
-- these in a separate batch since InventoryTxn is created in this same batch.
EXEC('ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_unitCost_nonneg] CHECK ([unitCost] >= 0)');
EXEC('ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_balanceQty_nonneg] CHECK ([balanceQty] >= 0)');
EXEC('ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_balanceAvgCost_nonneg] CHECK ([balanceAvgCost] >= 0)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

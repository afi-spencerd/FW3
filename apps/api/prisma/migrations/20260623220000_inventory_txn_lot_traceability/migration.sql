BEGIN TRY

BEGIN TRAN;

-- Attribute ledger lines to the acting user and the lot they pertain to.
ALTER TABLE [dbo].[InventoryTxn] ADD
    [createdById] CHAR(36),
    [lotId] CHAR(36);

-- AddForeignKey
ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_lotId_fkey] FOREIGN KEY ([lotId]) REFERENCES [dbo].[ReceivedLot]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryTxn_tenantId_itemId_state_lotId_idx] ON [dbo].[InventoryTxn]([tenantId], [itemId], [state], [lotId]);
CREATE NONCLUSTERED INDEX [InventoryTxn_lotId_idx] ON [dbo].[InventoryTxn]([lotId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

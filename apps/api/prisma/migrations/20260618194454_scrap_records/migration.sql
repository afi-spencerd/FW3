BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ScrapRecord] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [state] NVARCHAR(10) NOT NULL,
    [locationId] CHAR(36),
    [quantity] DECIMAL(18,4) NOT NULL,
    [value] DECIMAL(38,4) NOT NULL,
    [reason] NVARCHAR(20) NOT NULL,
    [note] NVARCHAR(500),
    [operatorId] CHAR(36) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [ScrapRecord_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ScrapRecord_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScrapRecord_tenantId_itemId_occurredAt_idx] ON [dbo].[ScrapRecord]([tenantId], [itemId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ScrapRecord_tenantId_reason_idx] ON [dbo].[ScrapRecord]([tenantId], [reason]);

-- AddForeignKey
ALTER TABLE [dbo].[ScrapRecord] ADD CONSTRAINT [ScrapRecord_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ScrapRecord] ADD CONSTRAINT [ScrapRecord_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ScrapRecord] ADD CONSTRAINT [ScrapRecord_locationId_fkey] FOREIGN KEY ([locationId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ScrapRecord] ADD CONSTRAINT [ScrapRecord_operatorId_fkey] FOREIGN KEY ([operatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Scrap can come from any stage; reason is a fixed set.
ALTER TABLE [dbo].[ScrapRecord] ADD CONSTRAINT [ScrapRecord_state_allowed] CHECK ([state] IN ('INV', 'WIP', 'QUARANTINE'));
ALTER TABLE [dbo].[ScrapRecord] ADD CONSTRAINT [ScrapRecord_reason_allowed] CHECK ([reason] IN ('DAMAGED', 'EXPIRED', 'CONTAMINATED', 'SPILL', 'QC_FAILED', 'OTHER'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

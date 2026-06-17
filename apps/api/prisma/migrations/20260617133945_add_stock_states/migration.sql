BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[InventoryTxn] ADD [state] NVARCHAR(10) NOT NULL CONSTRAINT [InventoryTxn_state_df] DEFAULT 'INV';

-- CreateTable
CREATE TABLE [dbo].[ItemStock] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [state] NVARCHAR(10) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL CONSTRAINT [ItemStock_quantity_df] DEFAULT 0,
    [avgCost] DECIMAL(19,4) NOT NULL CONSTRAINT [ItemStock_avgCost_df] DEFAULT 0,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ItemStock_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ItemStock_itemId_state_key] UNIQUE NONCLUSTERED ([itemId],[state])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ItemStock_tenantId_state_idx] ON [dbo].[ItemStock]([tenantId], [state]);

-- AddForeignKey
ALTER TABLE [dbo].[ItemStock] ADD CONSTRAINT [ItemStock_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ItemStock] ADD CONSTRAINT [ItemStock_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Backfill the INV (LOT-traceable) position from each item's current on-hand,
-- so ItemStock is authoritative from day one. EXEC()'d (references tables touched
-- in this same batch).
EXEC('INSERT INTO [dbo].[ItemStock] ([id],[tenantId],[itemId],[state],[quantity],[avgCost],[updatedAt])
SELECT LOWER(CONVERT(CHAR(36), NEWID())), [tenantId], [id], ''INV'', [quantityOnHand], [unitCost], SYSUTCDATETIME()
FROM [dbo].[InventoryItem]');

-- DB-level guardrails.
EXEC('ALTER TABLE [dbo].[ItemStock] ADD CONSTRAINT [ItemStock_state_allowed] CHECK ([state] IN (''INV'', ''WIP''))');
EXEC('ALTER TABLE [dbo].[ItemStock] ADD CONSTRAINT [ItemStock_quantity_nonneg] CHECK ([quantity] >= 0)');
EXEC('ALTER TABLE [dbo].[ItemStock] ADD CONSTRAINT [ItemStock_avgCost_nonneg] CHECK ([avgCost] >= 0)');
EXEC('ALTER TABLE [dbo].[InventoryTxn] ADD CONSTRAINT [InventoryTxn_state_allowed] CHECK ([state] IN (''INV'', ''WIP''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

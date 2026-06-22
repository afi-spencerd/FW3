BEGIN TRY

BEGIN TRAN;

-- AlterTable: raw-material regulatory attributes on the item master.
ALTER TABLE [dbo].[InventoryItem] ADD
    [productionUse] BIT NOT NULL CONSTRAINT [InventoryItem_productionUse_df] DEFAULT 1,
    [casNumber] NVARCHAR(40),
    [flashPointC] DECIMAL(7,2),
    [prop65Status] NVARCHAR(20) NOT NULL CONSTRAINT [InventoryItem_prop65Status_df] DEFAULT 'UNKNOWN',
    [prop65Notes] NVARCHAR(500);

-- Prop-65 status is a fixed set (column added this batch -> EXEC the constraint).
EXEC('ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_prop65Status_allowed] CHECK ([prop65Status] IN (''UNKNOWN'', ''NOT_LISTED'', ''LISTED''))');

-- CreateTable: per-item IFRA category usage limits.
CREATE TABLE [dbo].[IfraCategoryLimit] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [category] NVARCHAR(10) NOT NULL,
    [maxPercent] DECIMAL(7,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IfraCategoryLimit_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [IfraCategoryLimit_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [IfraCategoryLimit_itemId_category_key] ON [dbo].[IfraCategoryLimit]([itemId], [category]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IfraCategoryLimit_tenantId_idx] ON [dbo].[IfraCategoryLimit]([tenantId]);

-- AddForeignKey
ALTER TABLE [dbo].[IfraCategoryLimit] ADD CONSTRAINT [IfraCategoryLimit_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[IfraCategoryLimit] ADD CONSTRAINT [IfraCategoryLimit_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Usage limit is a percentage in [0, 100].
ALTER TABLE [dbo].[IfraCategoryLimit] ADD CONSTRAINT [IfraCategoryLimit_maxPercent_range] CHECK ([maxPercent] >= 0 AND [maxPercent] <= 100);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

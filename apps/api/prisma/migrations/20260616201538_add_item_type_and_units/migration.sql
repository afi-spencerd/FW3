BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[InventoryItem] DROP CONSTRAINT [InventoryItem_unitOfMeasure_df];
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_unitOfMeasure_df] DEFAULT 'LB' FOR [unitOfMeasure];
ALTER TABLE [dbo].[InventoryItem] ADD [itemType] NVARCHAR(20) NOT NULL CONSTRAINT [InventoryItem_itemType_df] DEFAULT 'RAW_MATERIAL';

-- Backfill legacy unit values before constraining (earlier seed used 'EA').
UPDATE [dbo].[InventoryItem] SET [unitOfMeasure] = 'LB' WHERE [unitOfMeasure] NOT IN ('LB', 'KG');

-- DB-level CHECK constraints (SQL Server has no native enum) — keep itemType and
-- unitOfMeasure within their allowed sets at the database, not app code alone.
-- The itemType CHECK references the column just added in this batch, so it must
-- run in a separate batch via EXEC() (SQL Server compiles a batch before running it).
EXEC('ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_itemType_allowed] CHECK ([itemType] IN (''RAW_MATERIAL'', ''FINISHED_GOOD''))');
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_unitOfMeasure_allowed] CHECK ([unitOfMeasure] IN ('LB', 'KG'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

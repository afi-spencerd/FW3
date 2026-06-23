BEGIN TRY

BEGIN TRAN;

-- AlterTable: per-item / per-container reorder threshold (null = not tracked).
ALTER TABLE [dbo].[InventoryItem] ADD [reorderPoint] DECIMAL(18,4);
ALTER TABLE [dbo].[Container] ADD [reorderPoint] DECIMAL(18,4);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

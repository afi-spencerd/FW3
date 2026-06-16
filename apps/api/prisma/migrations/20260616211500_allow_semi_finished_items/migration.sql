-- Widen the itemType CHECK to include SEMI_FINISHED (bases/solutions/mixtures).
-- itemType is a plain NVARCHAR guarded by a CHECK (SQL Server has no enum), so
-- this change is invisible to the Prisma schema and is applied by hand.
BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[InventoryItem] DROP CONSTRAINT [InventoryItem_itemType_allowed];
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_itemType_allowed] CHECK ([itemType] IN ('RAW_MATERIAL', 'SEMI_FINISHED', 'FINISHED_GOOD'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

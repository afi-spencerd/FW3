BEGIN TRY

BEGIN TRAN;

-- AlterTable: a cycle count may instead be scoped to a single item, counted
-- across every location it sits in.
ALTER TABLE [dbo].[CycleCount] ADD [scopeItemId] CHAR(36);

-- The item scope references the item master.
ALTER TABLE [dbo].[CycleCount] ADD CONSTRAINT [CycleCount_scopeItemId_fkey] FOREIGN KEY ([scopeItemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A count is scoped by location OR by item, never both.
EXEC('ALTER TABLE [dbo].[CycleCount] ADD CONSTRAINT [CycleCount_scope_one] CHECK ((CASE WHEN [scopeLocationId] IS NULL THEN 0 ELSE 1 END) + (CASE WHEN [scopeItemId] IS NULL THEN 0 ELSE 1 END) <= 1)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

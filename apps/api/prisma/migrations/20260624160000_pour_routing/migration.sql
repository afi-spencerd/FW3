BEGIN TRY

BEGIN TRAN;

-- Floor-only routing flag + reason on the raw-material item master.
ALTER TABLE [dbo].[InventoryItem] ADD [restrictToFloor] BIT NOT NULL CONSTRAINT [InventoryItem_restrictToFloor_df] DEFAULT 0;
ALTER TABLE [dbo].[InventoryItem] ADD [floorOnlyReason] NVARCHAR(500);

-- Where each pour (work-order component line) is assigned.
ALTER TABLE [dbo].[ProductionRunLine] ADD [assignedLocation] NVARCHAR(20);

-- Guardrail: pour location is a fixed set when present (column created this batch).
EXEC('ALTER TABLE [dbo].[ProductionRunLine] ADD CONSTRAINT [ProductionRunLine_assignedLocation_allowed] CHECK ([assignedLocation] IS NULL OR [assignedLocation] IN (''FLOOR'', ''LAB'', ''ROBOT''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[InventoryItem] ADD [physicalForm] NVARCHAR(10) NOT NULL CONSTRAINT [InventoryItem_physicalForm_df] DEFAULT 'LIQUID';

-- physicalForm guardrail (column added in this batch -> EXEC).
EXEC('ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_physicalForm_allowed] CHECK ([physicalForm] IN (''LIQUID'', ''SOLID''))');

-- Rename the COLOR test to the Gardner numeric test and widen the allowed set.
-- Drop the old CHECKs first so the UPDATE to the new value is permitted.
ALTER TABLE [dbo].[ItemQualitySpec] DROP CONSTRAINT [ItemQualitySpec_testType_allowed];
ALTER TABLE [dbo].[QualityTestResult] DROP CONSTRAINT [QualityTestResult_testType_allowed];
UPDATE [dbo].[ItemQualitySpec] SET [testType] = 'GARDNER_COLOR' WHERE [testType] = 'COLOR';
UPDATE [dbo].[QualityTestResult] SET [testType] = 'GARDNER_COLOR' WHERE [testType] = 'COLOR';
ALTER TABLE [dbo].[ItemQualitySpec] ADD CONSTRAINT [ItemQualitySpec_testType_allowed] CHECK ([testType] IN ('SPECIFIC_GRAVITY', 'REFRACTIVE_INDEX', 'GARDNER_COLOR', 'ODOR', 'APPEARANCE', 'MELTING_POINT'));
ALTER TABLE [dbo].[QualityTestResult] ADD CONSTRAINT [QualityTestResult_testType_allowed] CHECK ([testType] IN ('SPECIFIC_GRAVITY', 'REFRACTIVE_INDEX', 'GARDNER_COLOR', 'ODOR', 'APPEARANCE', 'MELTING_POINT'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

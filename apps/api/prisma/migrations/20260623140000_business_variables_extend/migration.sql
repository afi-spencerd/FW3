BEGIN TRY

BEGIN TRAN;

-- Business-variable values become text (so non-numeric types like TIME fit).
-- Existing decimal values convert implicitly (e.g. 85.0000 -> '85.0000').
ALTER TABLE [dbo].[BusinessVariableValue] ALTER COLUMN [value] NVARCHAR(120) NOT NULL;

-- Add SAMPLE_LAB to the allowed operator roles (drop + recreate the CHECK).
ALTER TABLE [dbo].[BusinessVariableValue] DROP CONSTRAINT [BusinessVariableValue_operatorRole_allowed];
EXEC('ALTER TABLE [dbo].[BusinessVariableValue] ADD CONSTRAINT [BusinessVariableValue_operatorRole_allowed] CHECK ([operatorRole] IS NULL OR [operatorRole] IN (''FLOOR'', ''LAB'', ''SAMPLE_LAB''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

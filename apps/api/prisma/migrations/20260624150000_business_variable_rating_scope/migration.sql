BEGIN TRY

BEGIN TRAN;

-- Business variables can now be scoped by customer rating (A/B/C/D) in addition
-- to operator role: a base row (both scope columns null) plus per-rating overrides.
ALTER TABLE [dbo].[BusinessVariableValue] ADD [customerRating] NVARCHAR(1);

-- Widen the uniqueness slot to include the new scope dimension.
DROP INDEX [BusinessVariableValue_tenantId_key_operatorRole_key] ON [dbo].[BusinessVariableValue];
CREATE UNIQUE NONCLUSTERED INDEX [BusinessVariableValue_tenantId_key_operatorRole_customerRating_key] ON [dbo].[BusinessVariableValue]([tenantId], [key], [operatorRole], [customerRating]);

-- Guardrail: customerRating is a fixed set when present (column created this batch).
EXEC('ALTER TABLE [dbo].[BusinessVariableValue] ADD CONSTRAINT [BusinessVariableValue_customerRating_allowed] CHECK ([customerRating] IS NULL OR [customerRating] IN (''A'', ''B'', ''C'', ''D''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

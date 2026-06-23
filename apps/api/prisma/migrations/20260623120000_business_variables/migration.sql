BEGIN TRY

BEGIN TRAN;

-- CreateTable: tenant overrides for catalog business variables.
CREATE TABLE [dbo].[BusinessVariableValue] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [key] NVARCHAR(80) NOT NULL,
    [operatorRole] NVARCHAR(20),
    [value] DECIMAL(19,4) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BusinessVariableValue_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BusinessVariableValue_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex: one row per (tenant, key, role). NULL role = the single non-scoped slot.
CREATE UNIQUE NONCLUSTERED INDEX [BusinessVariableValue_tenantId_key_operatorRole_key] ON [dbo].[BusinessVariableValue]([tenantId], [key], [operatorRole]);
CREATE NONCLUSTERED INDEX [BusinessVariableValue_tenantId_idx] ON [dbo].[BusinessVariableValue]([tenantId]);

-- AddForeignKey
ALTER TABLE [dbo].[BusinessVariableValue] ADD CONSTRAINT [BusinessVariableValue_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Guardrail: operatorRole is a fixed set when present (column created this batch).
EXEC('ALTER TABLE [dbo].[BusinessVariableValue] ADD CONSTRAINT [BusinessVariableValue_operatorRole_allowed] CHECK ([operatorRole] IS NULL OR [operatorRole] IN (''FLOOR'', ''LAB''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

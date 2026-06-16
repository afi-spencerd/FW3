BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Formula] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [finishedGoodId] CHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Formula_version_df] DEFAULT 1,
    [notes] NVARCHAR(2000),
    [isActive] BIT NOT NULL CONSTRAINT [Formula_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Formula_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Formula_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Formula_tenantId_finishedGoodId_version_key] UNIQUE NONCLUSTERED ([tenantId],[finishedGoodId],[version])
);

-- CreateTable
CREATE TABLE [dbo].[FormulaLine] (
    [id] CHAR(36) NOT NULL,
    [formulaId] CHAR(36) NOT NULL,
    [rawMaterialId] CHAR(36) NOT NULL,
    [percentage] DECIMAL(7,4) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [FormulaLine_sortOrder_df] DEFAULT 0,
    CONSTRAINT [FormulaLine_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FormulaLine_formulaId_rawMaterialId_key] UNIQUE NONCLUSTERED ([formulaId],[rawMaterialId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Formula_tenantId_idx] ON [dbo].[Formula]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FormulaLine_formulaId_idx] ON [dbo].[FormulaLine]([formulaId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FormulaLine_rawMaterialId_idx] ON [dbo].[FormulaLine]([rawMaterialId]);

-- AddForeignKey
ALTER TABLE [dbo].[Formula] ADD CONSTRAINT [Formula_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Formula] ADD CONSTRAINT [Formula_finishedGoodId_fkey] FOREIGN KEY ([finishedGoodId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[FormulaLine] ADD CONSTRAINT [FormulaLine_formulaId_fkey] FOREIGN KEY ([formulaId]) REFERENCES [dbo].[Formula]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[FormulaLine] ADD CONSTRAINT [FormulaLine_rawMaterialId_fkey] FOREIGN KEY ([rawMaterialId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Per-line range guard: 0 < percentage <= 100. (Sum-to-100 across a formula's
-- lines is cross-row, so it's enforced in the service, not here.) EXEC() runs it
-- in a separate batch since FormulaLine is created in this same batch.
EXEC('ALTER TABLE [dbo].[FormulaLine] ADD CONSTRAINT [FormulaLine_percentage_range] CHECK ([percentage] > 0 AND [percentage] <= 100)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

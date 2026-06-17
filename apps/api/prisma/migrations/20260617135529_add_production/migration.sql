BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ProductionRun] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [runNumber] NVARCHAR(50) NOT NULL,
    [targetItemId] CHAR(36) NOT NULL,
    [formulaId] CHAR(36) NOT NULL,
    [batchSize] DECIMAL(18,4) NOT NULL,
    [batchUnit] NVARCHAR(16) NOT NULL,
    [outputQty] DECIMAL(18,4) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [ProductionRun_status_df] DEFAULT 'PLANNED',
    [notes] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ProductionRun_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ProductionRun_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ProductionRun_tenantId_runNumber_key] UNIQUE NONCLUSTERED ([tenantId],[runNumber])
);

-- CreateTable
CREATE TABLE [dbo].[ProductionRunLine] (
    [id] CHAR(36) NOT NULL,
    [productionRunId] CHAR(36) NOT NULL,
    [componentId] CHAR(36) NOT NULL,
    [requiredQty] DECIMAL(18,4) NOT NULL,
    [stagedQty] DECIMAL(18,4) NOT NULL CONSTRAINT [ProductionRunLine_stagedQty_df] DEFAULT 0,
    [consumedQty] DECIMAL(18,4) NOT NULL CONSTRAINT [ProductionRunLine_consumedQty_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [ProductionRunLine_sortOrder_df] DEFAULT 0,
    CONSTRAINT [ProductionRunLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProductionRun_tenantId_idx] ON [dbo].[ProductionRun]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProductionRunLine_productionRunId_idx] ON [dbo].[ProductionRunLine]([productionRunId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProductionRunLine_componentId_idx] ON [dbo].[ProductionRunLine]([componentId]);

-- AddForeignKey
ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_targetItemId_fkey] FOREIGN KEY ([targetItemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_formulaId_fkey] FOREIGN KEY ([formulaId]) REFERENCES [dbo].[Formula]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProductionRunLine] ADD CONSTRAINT [ProductionRunLine_productionRunId_fkey] FOREIGN KEY ([productionRunId]) REFERENCES [dbo].[ProductionRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ProductionRunLine] ADD CONSTRAINT [ProductionRunLine_componentId_fkey] FOREIGN KEY ([componentId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- DB-level guardrails (EXEC()'d — tables created in this same batch).
EXEC('ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_status_allowed] CHECK ([status] IN (''PLANNED'', ''STAGED'', ''COMPLETED'', ''CANCELLED''))');
EXEC('ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_batchSize_pos] CHECK ([batchSize] > 0)');
EXEC('ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_outputQty_pos] CHECK ([outputQty] > 0)');
EXEC('ALTER TABLE [dbo].[ProductionRunLine] ADD CONSTRAINT [ProductionRunLine_required_nonneg] CHECK ([requiredQty] >= 0 AND [stagedQty] >= 0 AND [consumedQty] >= 0)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

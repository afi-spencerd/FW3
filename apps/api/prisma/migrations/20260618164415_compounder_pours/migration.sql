BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[CompounderPour] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [productionRunId] CHAR(36) NOT NULL,
    [productionRunLineId] CHAR(36) NOT NULL,
    [componentId] CHAR(36) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL,
    [operatorId] CHAR(36) NOT NULL,
    [note] NVARCHAR(500),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [CompounderPour_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CompounderPour_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CompounderPour_tenantId_productionRunId_idx] ON [dbo].[CompounderPour]([tenantId], [productionRunId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CompounderPour_operatorId_idx] ON [dbo].[CompounderPour]([operatorId]);

-- AddForeignKey
ALTER TABLE [dbo].[CompounderPour] ADD CONSTRAINT [CompounderPour_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CompounderPour] ADD CONSTRAINT [CompounderPour_productionRunId_fkey] FOREIGN KEY ([productionRunId]) REFERENCES [dbo].[ProductionRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CompounderPour] ADD CONSTRAINT [CompounderPour_productionRunLineId_fkey] FOREIGN KEY ([productionRunLineId]) REFERENCES [dbo].[ProductionRunLine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CompounderPour] ADD CONSTRAINT [CompounderPour_componentId_fkey] FOREIGN KEY ([componentId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CompounderPour] ADD CONSTRAINT [CompounderPour_operatorId_fkey] FOREIGN KEY ([operatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Widen the work-order status set: add IN_PROGRESS and ON_HOLD for the
-- compounder lifecycle.
ALTER TABLE [dbo].[ProductionRun] DROP CONSTRAINT [ProductionRun_status_allowed];
ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_status_allowed] CHECK ([status] IN ('PLANNED', 'STAGED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[CycleCount] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [reference] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [CycleCount_status_df] DEFAULT 'OPEN',
    [blind] BIT NOT NULL CONSTRAINT [CycleCount_blind_df] DEFAULT 0,
    [scopeLocationId] CHAR(36),
    [note] NVARCHAR(500),
    [createdById] CHAR(36) NOT NULL,
    [completedById] CHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CycleCount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [completedAt] DATETIME2,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CycleCount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CycleCount_tenantId_reference_key] UNIQUE NONCLUSTERED ([tenantId],[reference])
);

-- CreateTable
CREATE TABLE [dbo].[CycleCountLine] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [cycleCountId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [state] NVARCHAR(10) NOT NULL,
    [locationId] CHAR(36) NOT NULL,
    [expectedQty] DECIMAL(18,4) NOT NULL,
    [countedQty] DECIMAL(18,4),
    [counted] BIT NOT NULL CONSTRAINT [CycleCountLine_counted_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CycleCountLine_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CycleCountLine_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CycleCountLine_cycleCountId_itemId_state_locationId_key] UNIQUE NONCLUSTERED ([cycleCountId],[itemId],[state],[locationId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CycleCount_tenantId_status_idx] ON [dbo].[CycleCount]([tenantId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CycleCountLine_cycleCountId_idx] ON [dbo].[CycleCountLine]([cycleCountId]);

-- AddForeignKey
ALTER TABLE [dbo].[CycleCount] ADD CONSTRAINT [CycleCount_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CycleCount] ADD CONSTRAINT [CycleCount_scopeLocationId_fkey] FOREIGN KEY ([scopeLocationId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CycleCount] ADD CONSTRAINT [CycleCount_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CycleCount] ADD CONSTRAINT [CycleCount_completedById_fkey] FOREIGN KEY ([completedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CycleCountLine] ADD CONSTRAINT [CycleCountLine_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CycleCountLine] ADD CONSTRAINT [CycleCountLine_cycleCountId_fkey] FOREIGN KEY ([cycleCountId]) REFERENCES [dbo].[CycleCount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CycleCountLine] ADD CONSTRAINT [CycleCountLine_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CycleCountLine] ADD CONSTRAINT [CycleCountLine_locationId_fkey] FOREIGN KEY ([locationId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Status + located-stock guardrails.
ALTER TABLE [dbo].[CycleCount] ADD CONSTRAINT [CycleCount_status_allowed] CHECK ([status] IN ('OPEN', 'COMPLETED', 'CANCELLED'));
ALTER TABLE [dbo].[CycleCountLine] ADD CONSTRAINT [CycleCountLine_state_allowed] CHECK ([state] IN ('INV', 'QUARANTINE'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

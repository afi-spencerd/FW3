BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Location] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [code] NVARCHAR(30),
    [isDefault] BIT NOT NULL CONSTRAINT [Location_isDefault_df] DEFAULT 0,
    [isReceiving] BIT NOT NULL CONSTRAINT [Location_isReceiving_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [Location_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Location_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Location_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Location_tenantId_name_key] UNIQUE NONCLUSTERED ([tenantId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[ItemStockLocation] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [state] NVARCHAR(10) NOT NULL,
    [locationId] CHAR(36) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL CONSTRAINT [ItemStockLocation_quantity_df] DEFAULT 0,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ItemStockLocation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ItemStockLocation_itemId_state_locationId_key] UNIQUE NONCLUSTERED ([itemId],[state],[locationId])
);

-- CreateTable
CREATE TABLE [dbo].[LocationMove] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [state] NVARCHAR(10) NOT NULL,
    [fromLocationId] CHAR(36),
    [toLocationId] CHAR(36),
    [quantity] DECIMAL(18,4) NOT NULL,
    [note] NVARCHAR(500),
    [actorId] CHAR(36),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [LocationMove_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LocationMove_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Location_tenantId_idx] ON [dbo].[Location]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ItemStockLocation_tenantId_idx] ON [dbo].[ItemStockLocation]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ItemStockLocation_locationId_idx] ON [dbo].[ItemStockLocation]([locationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LocationMove_tenantId_itemId_occurredAt_idx] ON [dbo].[LocationMove]([tenantId], [itemId], [occurredAt]);

-- AddForeignKey
ALTER TABLE [dbo].[Location] ADD CONSTRAINT [Location_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ItemStockLocation] ADD CONSTRAINT [ItemStockLocation_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ItemStockLocation] ADD CONSTRAINT [ItemStockLocation_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ItemStockLocation] ADD CONSTRAINT [ItemStockLocation_locationId_fkey] FOREIGN KEY ([locationId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LocationMove] ADD CONSTRAINT [LocationMove_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LocationMove] ADD CONSTRAINT [LocationMove_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LocationMove] ADD CONSTRAINT [LocationMove_fromLocationId_fkey] FOREIGN KEY ([fromLocationId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LocationMove] ADD CONSTRAINT [LocationMove_toLocationId_fkey] FOREIGN KEY ([toLocationId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Only located statuses may carry a location (INV usable, QUARANTINE on the dock).
ALTER TABLE [dbo].[ItemStockLocation] ADD CONSTRAINT [ItemStockLocation_state_allowed] CHECK ([state] IN ('INV', 'QUARANTINE'));
ALTER TABLE [dbo].[LocationMove] ADD CONSTRAINT [LocationMove_state_allowed] CHECK ([state] IN ('INV', 'QUARANTINE'));

-- At most one default and one receiving location per tenant (filtered unique).
CREATE UNIQUE NONCLUSTERED INDEX [Location_one_default_per_tenant] ON [dbo].[Location]([tenantId]) WHERE [isDefault] = 1;
CREATE UNIQUE NONCLUSTERED INDEX [Location_one_receiving_per_tenant] ON [dbo].[Location]([tenantId]) WHERE [isReceiving] = 1;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

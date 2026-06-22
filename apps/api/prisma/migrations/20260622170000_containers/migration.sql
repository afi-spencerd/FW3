BEGIN TRY

BEGIN TRAN;

-- AlterTable: packing plan on sales-order lines + packed marker on the order.
ALTER TABLE [dbo].[SalesOrderLine] ADD
    [containerId] CHAR(36),
    [containerQuantity] DECIMAL(18,4);

ALTER TABLE [dbo].[SalesOrder] ADD [packedAt] DATETIME2;

-- CreateTable
CREATE TABLE [dbo].[Container] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [sku] NVARCHAR(64) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [containerType] NVARCHAR(20) NOT NULL,
    [capacityLb] DECIMAL(18,4),
    [standardCost] DECIMAL(19,4) NOT NULL CONSTRAINT [Container_standardCost_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [Container_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Container_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Container_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ContainerStock] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [containerId] CHAR(36) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL CONSTRAINT [ContainerStock_quantity_df] DEFAULT 0,
    [avgCost] DECIMAL(19,4) NOT NULL CONSTRAINT [ContainerStock_avgCost_df] DEFAULT 0,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ContainerStock_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ContainerTxn] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [containerId] CHAR(36) NOT NULL,
    [type] NVARCHAR(20) NOT NULL,
    [quantity] DECIMAL(18,4) NOT NULL,
    [unitCost] DECIMAL(19,4) NOT NULL,
    [value] DECIMAL(38,4) NOT NULL,
    [balanceQty] DECIMAL(18,4) NOT NULL,
    [balanceAvgCost] DECIMAL(19,4) NOT NULL,
    [reason] NVARCHAR(20),
    [note] NVARCHAR(500),
    [docType] NVARCHAR(30),
    [docId] CHAR(36),
    [operatorId] CHAR(36),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [ContainerTxn_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ContainerTxn_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [Container_tenantId_sku_key] ON [dbo].[Container]([tenantId], [sku]);
CREATE NONCLUSTERED INDEX [Container_tenantId_idx] ON [dbo].[Container]([tenantId]);
CREATE UNIQUE NONCLUSTERED INDEX [ContainerStock_containerId_key] ON [dbo].[ContainerStock]([containerId]);
CREATE NONCLUSTERED INDEX [ContainerStock_tenantId_idx] ON [dbo].[ContainerStock]([tenantId]);
CREATE NONCLUSTERED INDEX [ContainerTxn_tenantId_containerId_occurredAt_idx] ON [dbo].[ContainerTxn]([tenantId], [containerId], [occurredAt]);
CREATE NONCLUSTERED INDEX [SalesOrderLine_containerId_idx] ON [dbo].[SalesOrderLine]([containerId]);

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_containerId_fkey] FOREIGN KEY ([containerId]) REFERENCES [dbo].[Container]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Container] ADD CONSTRAINT [Container_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ContainerStock] ADD CONSTRAINT [ContainerStock_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ContainerStock] ADD CONSTRAINT [ContainerStock_containerId_fkey] FOREIGN KEY ([containerId]) REFERENCES [dbo].[Container]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ContainerTxn] ADD CONSTRAINT [ContainerTxn_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ContainerTxn] ADD CONSTRAINT [ContainerTxn_containerId_fkey] FOREIGN KEY ([containerId]) REFERENCES [dbo].[Container]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Guardrails: container type and ledger type are fixed sets (EXEC: columns added/created this batch).
EXEC('ALTER TABLE [dbo].[Container] ADD CONSTRAINT [Container_containerType_allowed] CHECK ([containerType] IN (''DRUM'', ''PAIL'', ''JUG'', ''CAN'', ''BOTTLE'', ''TOTE'', ''OTHER''))');
EXEC('ALTER TABLE [dbo].[ContainerTxn] ADD CONSTRAINT [ContainerTxn_type_allowed] CHECK ([type] IN (''ADJUSTMENT'', ''CONSUME'', ''SCRAP''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

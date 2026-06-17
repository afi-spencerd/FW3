BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Customer] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [code] NVARCHAR(50),
    [email] NVARCHAR(320),
    [isActive] BIT NOT NULL CONSTRAINT [Customer_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Customer_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Customer_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Customer_tenantId_name_key] UNIQUE NONCLUSTERED ([tenantId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[SalesOrder] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [customerId] CHAR(36) NOT NULL,
    [soNumber] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [SalesOrder_status_df] DEFAULT 'OPEN',
    [orderDate] DATETIME2 NOT NULL CONSTRAINT [SalesOrder_orderDate_df] DEFAULT CURRENT_TIMESTAMP,
    [notes] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SalesOrder_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SalesOrder_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SalesOrder_tenantId_soNumber_key] UNIQUE NONCLUSTERED ([tenantId],[soNumber])
);

-- CreateTable
CREATE TABLE [dbo].[SalesOrderLine] (
    [id] CHAR(36) NOT NULL,
    [salesOrderId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [quantityOrdered] DECIMAL(18,4) NOT NULL,
    [unitPrice] DECIMAL(19,4) NOT NULL,
    [quantityShipped] DECIMAL(18,4) NOT NULL CONSTRAINT [SalesOrderLine_quantityShipped_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [SalesOrderLine_sortOrder_df] DEFAULT 0,
    CONSTRAINT [SalesOrderLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Customer_tenantId_idx] ON [dbo].[Customer]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SalesOrder_tenantId_idx] ON [dbo].[SalesOrder]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SalesOrder_tenantId_customerId_idx] ON [dbo].[SalesOrder]([tenantId], [customerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SalesOrderLine_salesOrderId_idx] ON [dbo].[SalesOrderLine]([salesOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SalesOrderLine_itemId_idx] ON [dbo].[SalesOrderLine]([itemId]);

-- AddForeignKey
ALTER TABLE [dbo].[Customer] ADD CONSTRAINT [Customer_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrder] ADD CONSTRAINT [SalesOrder_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrder] ADD CONSTRAINT [SalesOrder_customerId_fkey] FOREIGN KEY ([customerId]) REFERENCES [dbo].[Customer]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_salesOrderId_fkey] FOREIGN KEY ([salesOrderId]) REFERENCES [dbo].[SalesOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- DB-level guardrails (EXEC()'d — tables created in this same batch).
EXEC('ALTER TABLE [dbo].[SalesOrder] ADD CONSTRAINT [SalesOrder_status_allowed] CHECK ([status] IN (''OPEN'', ''PARTIAL'', ''SHIPPED'', ''CANCELLED''))');
EXEC('ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_qtyOrdered_pos] CHECK ([quantityOrdered] > 0)');
EXEC('ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_unitPrice_nonneg] CHECK ([unitPrice] >= 0)');
EXEC('ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_shipped_range] CHECK ([quantityShipped] >= 0 AND [quantityShipped] <= [quantityOrdered])');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

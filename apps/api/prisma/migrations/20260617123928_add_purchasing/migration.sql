BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Vendor] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [code] NVARCHAR(50),
    [email] NVARCHAR(320),
    [isActive] BIT NOT NULL CONSTRAINT [Vendor_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Vendor_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Vendor_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Vendor_tenantId_name_key] UNIQUE NONCLUSTERED ([tenantId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseOrder] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [vendorId] CHAR(36) NOT NULL,
    [poNumber] NVARCHAR(50) NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [PurchaseOrder_status_df] DEFAULT 'OPEN',
    [orderDate] DATETIME2 NOT NULL CONSTRAINT [PurchaseOrder_orderDate_df] DEFAULT CURRENT_TIMESTAMP,
    [notes] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PurchaseOrder_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PurchaseOrder_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PurchaseOrder_tenantId_poNumber_key] UNIQUE NONCLUSTERED ([tenantId],[poNumber])
);

-- CreateTable
CREATE TABLE [dbo].[PurchaseOrderLine] (
    [id] CHAR(36) NOT NULL,
    [purchaseOrderId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [quantityOrdered] DECIMAL(18,4) NOT NULL,
    [unitCost] DECIMAL(19,4) NOT NULL,
    [quantityReceived] DECIMAL(18,4) NOT NULL CONSTRAINT [PurchaseOrderLine_quantityReceived_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [PurchaseOrderLine_sortOrder_df] DEFAULT 0,
    CONSTRAINT [PurchaseOrderLine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Vendor_tenantId_idx] ON [dbo].[Vendor]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseOrder_tenantId_idx] ON [dbo].[PurchaseOrder]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseOrder_tenantId_vendorId_idx] ON [dbo].[PurchaseOrder]([tenantId], [vendorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseOrderLine_purchaseOrderId_idx] ON [dbo].[PurchaseOrderLine]([purchaseOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PurchaseOrderLine_itemId_idx] ON [dbo].[PurchaseOrderLine]([itemId]);

-- AddForeignKey
ALTER TABLE [dbo].[Vendor] ADD CONSTRAINT [Vendor_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseOrder] ADD CONSTRAINT [PurchaseOrder_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseOrder] ADD CONSTRAINT [PurchaseOrder_vendorId_fkey] FOREIGN KEY ([vendorId]) REFERENCES [dbo].[Vendor]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_purchaseOrderId_fkey] FOREIGN KEY ([purchaseOrderId]) REFERENCES [dbo].[PurchaseOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- DB-level guardrails. EXEC() runs them in separate batches since the tables are
-- created in this same batch.
EXEC('ALTER TABLE [dbo].[PurchaseOrder] ADD CONSTRAINT [PurchaseOrder_status_allowed] CHECK ([status] IN (''OPEN'', ''PARTIAL'', ''RECEIVED'', ''CANCELLED''))');
EXEC('ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_qtyOrdered_pos] CHECK ([quantityOrdered] > 0)');
EXEC('ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_unitCost_nonneg] CHECK ([unitCost] >= 0)');
-- Can't receive less than zero or more than ordered.
EXEC('ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_received_range] CHECK ([quantityReceived] >= 0 AND [quantityReceived] <= [quantityOrdered])');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

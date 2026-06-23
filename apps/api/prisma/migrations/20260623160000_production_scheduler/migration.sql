BEGIN TRY

BEGIN TRAN;

-- AlterTable: sales order gains a committed ship-by date + a paid marker.
ALTER TABLE [dbo].[SalesOrder] ADD
    [requestedShipDate] DATETIME2,
    [paidAt] DATETIME2;

-- AlterTable: work orders link back to the sales order / line they fulfil and
-- carry a run-queue position (set while QUEUED).
ALTER TABLE [dbo].[ProductionRun] ADD
    [salesOrderId] CHAR(36),
    [salesOrderLineId] CHAR(36),
    [queuePosition] INT;

-- CreateTable: lightweight purchasing shortage alert raised by the scheduler.
CREATE TABLE [dbo].[PurchasingAlert] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [workOrderId] CHAR(36),
    [shortQty] DECIMAL(18,4) NOT NULL,
    [note] NVARCHAR(500),
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [PurchasingAlert_status_df] DEFAULT 'OPEN',
    [raisedById] CHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PurchasingAlert_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [resolvedAt] DATETIME2,
    CONSTRAINT [PurchasingAlert_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProductionRun_tenantId_status_idx] ON [dbo].[ProductionRun]([tenantId], [status]);
CREATE NONCLUSTERED INDEX [ProductionRun_salesOrderId_idx] ON [dbo].[ProductionRun]([salesOrderId]);
CREATE NONCLUSTERED INDEX [PurchasingAlert_tenantId_status_idx] ON [dbo].[PurchasingAlert]([tenantId], [status]);
CREATE NONCLUSTERED INDEX [PurchasingAlert_itemId_idx] ON [dbo].[PurchasingAlert]([itemId]);

-- AddForeignKey
ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_salesOrderId_fkey] FOREIGN KEY ([salesOrderId]) REFERENCES [dbo].[SalesOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_salesOrderLineId_fkey] FOREIGN KEY ([salesOrderLineId]) REFERENCES [dbo].[SalesOrderLine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PurchasingAlert] ADD CONSTRAINT [PurchasingAlert_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PurchasingAlert] ADD CONSTRAINT [PurchasingAlert_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PurchasingAlert] ADD CONSTRAINT [PurchasingAlert_workOrderId_fkey] FOREIGN KEY ([workOrderId]) REFERENCES [dbo].[ProductionRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PurchasingAlert] ADD CONSTRAINT [PurchasingAlert_raisedById_fkey] FOREIGN KEY ([raisedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Guardrail: alert status is a fixed set (EXEC: column created this batch).
EXEC('ALTER TABLE [dbo].[PurchasingAlert] ADD CONSTRAINT [PurchasingAlert_status_allowed] CHECK ([status] IN (''OPEN'', ''RESOLVED''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

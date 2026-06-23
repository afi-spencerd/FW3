BEGIN TRY

BEGIN TRAN;

-- Sales-order lines can now sell an inventory item OR a container itself.
ALTER TABLE [dbo].[SalesOrderLine] ALTER COLUMN [itemId] CHAR(36) NULL;
ALTER TABLE [dbo].[SalesOrderLine] ADD
    [lineType] NVARCHAR(16) NOT NULL CONSTRAINT [SalesOrderLine_lineType_df] DEFAULT 'ITEM',
    [productContainerId] CHAR(36);

-- Shipment lines mirror that subject (item or container).
ALTER TABLE [dbo].[ShipmentLine] ALTER COLUMN [itemId] CHAR(36) NULL;
ALTER TABLE [dbo].[ShipmentLine] ADD
    [lineType] NVARCHAR(16) NOT NULL CONSTRAINT [ShipmentLine_lineType_df] DEFAULT 'ITEM',
    [containerId] CHAR(36);

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_productContainerId_fkey] FOREIGN KEY ([productContainerId]) REFERENCES [dbo].[Container]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ShipmentLine] ADD CONSTRAINT [ShipmentLine_containerId_fkey] FOREIGN KEY ([containerId]) REFERENCES [dbo].[Container]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Selling a container posts a SALE movement (OUT at average cost).
ALTER TABLE [dbo].[ContainerTxn] DROP CONSTRAINT [ContainerTxn_type_allowed];
ALTER TABLE [dbo].[ContainerTxn] ADD CONSTRAINT [ContainerTxn_type_allowed] CHECK ([type] IN ('ADJUSTMENT', 'CONSUME', 'SCRAP', 'SALE'));

-- Line-subject guards (EXEC: columns added in this batch).
EXEC('ALTER TABLE [dbo].[SalesOrderLine] ADD CONSTRAINT [SalesOrderLine_lineType_allowed] CHECK ([lineType] IN (''ITEM'', ''CONTAINER''))');
EXEC('ALTER TABLE [dbo].[ShipmentLine] ADD CONSTRAINT [ShipmentLine_lineType_allowed] CHECK ([lineType] IN (''ITEM'', ''CONTAINER''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

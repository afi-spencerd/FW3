BEGIN TRY

BEGIN TRAN;

-- CreateTable: partial payments recorded against a sales order.
CREATE TABLE [dbo].[SalesOrderPayment] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [salesOrderId] CHAR(36) NOT NULL,
    [method] NVARCHAR(20) NOT NULL,
    [amount] DECIMAL(19,4) NOT NULL,
    [convenienceFee] DECIMAL(19,4) NOT NULL CONSTRAINT [SalesOrderPayment_convenienceFee_df] DEFAULT 0,
    [reference] NVARCHAR(120),
    [note] NVARCHAR(500),
    [receivedById] CHAR(36) NOT NULL,
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [SalesOrderPayment_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SalesOrderPayment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SalesOrderPayment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SalesOrderPayment_tenantId_salesOrderId_idx] ON [dbo].[SalesOrderPayment]([tenantId], [salesOrderId]);

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrderPayment] ADD CONSTRAINT [SalesOrderPayment_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[SalesOrderPayment] ADD CONSTRAINT [SalesOrderPayment_salesOrderId_fkey] FOREIGN KEY ([salesOrderId]) REFERENCES [dbo].[SalesOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[SalesOrderPayment] ADD CONSTRAINT [SalesOrderPayment_receivedById_fkey] FOREIGN KEY ([receivedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Guardrail: payment method is a fixed set (EXEC: column created this batch).
EXEC('ALTER TABLE [dbo].[SalesOrderPayment] ADD CONSTRAINT [SalesOrderPayment_method_allowed] CHECK ([method] IN (''CASH'', ''CHECK'', ''CREDIT_CARD'', ''ACH'', ''WIRE'', ''OTHER''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

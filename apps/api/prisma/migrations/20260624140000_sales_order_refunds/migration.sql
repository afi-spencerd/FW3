BEGIN TRY

BEGIN TRAN;

-- CreateTable: refunds issued against a sales order (overpayment / cancellation).
CREATE TABLE [dbo].[SalesOrderRefund] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [salesOrderId] CHAR(36) NOT NULL,
    [method] NVARCHAR(20) NOT NULL,
    [amount] DECIMAL(19,4) NOT NULL,
    [reason] NVARCHAR(20) NOT NULL,
    [reference] NVARCHAR(120),
    [note] NVARCHAR(500),
    [issuedById] CHAR(36) NOT NULL,
    [issuedAt] DATETIME2 NOT NULL CONSTRAINT [SalesOrderRefund_issuedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SalesOrderRefund_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SalesOrderRefund_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SalesOrderRefund_tenantId_salesOrderId_idx] ON [dbo].[SalesOrderRefund]([tenantId], [salesOrderId]);

-- AddForeignKey
ALTER TABLE [dbo].[SalesOrderRefund] ADD CONSTRAINT [SalesOrderRefund_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[SalesOrderRefund] ADD CONSTRAINT [SalesOrderRefund_salesOrderId_fkey] FOREIGN KEY ([salesOrderId]) REFERENCES [dbo].[SalesOrder]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[SalesOrderRefund] ADD CONSTRAINT [SalesOrderRefund_issuedById_fkey] FOREIGN KEY ([issuedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Guardrail: refund method is a fixed set (EXEC: column created this batch).
EXEC('ALTER TABLE [dbo].[SalesOrderRefund] ADD CONSTRAINT [SalesOrderRefund_method_allowed] CHECK ([method] IN (''CASH'', ''CHECK'', ''CREDIT_CARD'', ''ACH'', ''WIRE'', ''OTHER''))');

-- Guardrail: refund reason is a fixed set.
EXEC('ALTER TABLE [dbo].[SalesOrderRefund] ADD CONSTRAINT [SalesOrderRefund_reason_allowed] CHECK ([reason] IN (''OVERPAYMENT'', ''CANCELLATION''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

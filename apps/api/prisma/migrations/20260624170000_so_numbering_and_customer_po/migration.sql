BEGIN TRY

BEGIN TRAN;

-- The customer's purchase-order reference on a sales order.
ALTER TABLE [dbo].[SalesOrder] ADD [customerPoNumber] NVARCHAR(100);

-- Per-tenant named counters for human-facing sequential numbers (sales orders, …).
CREATE TABLE [dbo].[NumberSequence] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [name] NVARCHAR(40) NOT NULL,
    [lastValue] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NumberSequence_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NumberSequence_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex: one counter row per (tenant, name).
CREATE UNIQUE NONCLUSTERED INDEX [NumberSequence_tenantId_name_key] ON [dbo].[NumberSequence]([tenantId], [name]);
CREATE NONCLUSTERED INDEX [NumberSequence_tenantId_idx] ON [dbo].[NumberSequence]([tenantId]);

-- AddForeignKey
ALTER TABLE [dbo].[NumberSequence] ADD CONSTRAINT [NumberSequence_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

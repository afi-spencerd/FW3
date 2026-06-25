BEGIN TRY

BEGIN TRAN;

-- AlterTable: per-customer credit limit (NULL = no limit; 0 = prepay-only).
ALTER TABLE [dbo].[Customer] ADD [creditLimit] DECIMAL(19,4);

-- Guardrail: a credit limit, when set, cannot be negative.
EXEC('ALTER TABLE [dbo].[Customer] ADD CONSTRAINT [Customer_creditLimit_nonneg] CHECK ([creditLimit] IS NULL OR [creditLimit] >= 0)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Customer] ADD [paymentTerms] NVARCHAR(20),
[rating] NVARCHAR(1),
[taxId] NVARCHAR(50);

-- AlterTable
ALTER TABLE [dbo].[Vendor] ADD [paymentTerms] NVARCHAR(20),
[taxId] NVARCHAR(50);

-- Guardrails for the new enum columns (NULL is allowed; non-null must be in set).
EXEC('ALTER TABLE [dbo].[Vendor] ADD CONSTRAINT [Vendor_paymentTerms_allowed] CHECK ([paymentTerms] IN (''DUE_ON_RECEIPT'', ''NET_15'', ''NET_30'', ''NET_45'', ''NET_60'', ''NET_90'', ''COD'', ''PREPAID''))');
EXEC('ALTER TABLE [dbo].[Customer] ADD CONSTRAINT [Customer_paymentTerms_allowed] CHECK ([paymentTerms] IN (''DUE_ON_RECEIPT'', ''NET_15'', ''NET_30'', ''NET_45'', ''NET_60'', ''NET_90'', ''COD'', ''PREPAID''))');
EXEC('ALTER TABLE [dbo].[Customer] ADD CONSTRAINT [Customer_rating_allowed] CHECK ([rating] IN (''A'', ''B'', ''C'', ''D''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

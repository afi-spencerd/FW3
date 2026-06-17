BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[ReceivedLot] ADD [origin] NVARCHAR(20) NOT NULL CONSTRAINT [ReceivedLot_origin_df] DEFAULT 'RECEIPT',
[packedQty] DECIMAL(18,4) NOT NULL CONSTRAINT [ReceivedLot_packedQty_df] DEFAULT 0,
[sourceWorkOrderId] CHAR(36),
[workOrderNumber] NVARCHAR(50);

-- Guardrails (EXEC()'d — columns added in this same batch).
EXEC('ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_origin_allowed] CHECK ([origin] IN (''RECEIPT'', ''PRODUCTION''))');
EXEC('ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_packedQty_range] CHECK ([packedQty] >= 0 AND [packedQty] <= [quantity])');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

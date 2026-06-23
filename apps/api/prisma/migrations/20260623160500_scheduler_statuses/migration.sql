BEGIN TRY

BEGIN TRAN;

-- Widen the work-order status guard to admit the scheduler lifecycle states
-- (REQUESTED, QUEUED) ahead of the existing floor pipeline.
ALTER TABLE [dbo].[ProductionRun] DROP CONSTRAINT [ProductionRun_status_allowed];
ALTER TABLE [dbo].[ProductionRun] ADD CONSTRAINT [ProductionRun_status_allowed] CHECK ([status] IN ('REQUESTED', 'QUEUED', 'PLANNED', 'STAGED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

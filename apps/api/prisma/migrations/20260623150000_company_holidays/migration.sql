BEGIN TRY

BEGIN TRAN;

-- CreateTable: rule-based company holiday calendar.
CREATE TABLE [dbo].[CompanyHoliday] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [ruleType] NVARCHAR(20) NOT NULL,
    [month] INT,
    [day] INT,
    [weekday] INT,
    [nth] INT,
    [date] DATE,
    [active] BIT NOT NULL CONSTRAINT [CompanyHoliday_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CompanyHoliday_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CompanyHoliday_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CompanyHoliday_tenantId_idx] ON [dbo].[CompanyHoliday]([tenantId]);

-- AddForeignKey
ALTER TABLE [dbo].[CompanyHoliday] ADD CONSTRAINT [CompanyHoliday_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Guardrail: rule type is a fixed set (column created this batch).
EXEC('ALTER TABLE [dbo].[CompanyHoliday] ADD CONSTRAINT [CompanyHoliday_ruleType_allowed] CHECK ([ruleType] IN (''FIXED'', ''NTH_WEEKDAY'', ''EXPLICIT''))');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

BEGIN TRY

BEGIN TRAN;

-- CreateTable: FormPak+ regulatory snapshot for a finished good.
CREATE TABLE [dbo].[FgRegulatoryProfile] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [itemId] CHAR(36) NOT NULL,
    [flashPointC] DECIMAL(7,2),
    [complianceStatus] NVARCHAR(20) NOT NULL CONSTRAINT [FgRegulatoryProfile_complianceStatus_df] DEFAULT 'UNKNOWN',
    [allergenDeclaration] NVARCHAR(2000),
    [certificateUrl] NVARCHAR(500),
    [formPakRef] NVARCHAR(80),
    [syncedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FgRegulatoryProfile_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FgRegulatoryProfile_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable: FormPak+ IFRA QRA level per category.
CREATE TABLE [dbo].[FgIfraLevel] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [profileId] CHAR(36) NOT NULL,
    [category] NVARCHAR(10) NOT NULL,
    [maxPercent] DECIMAL(7,4) NOT NULL,
    CONSTRAINT [FgIfraLevel_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [FgRegulatoryProfile_itemId_key] ON [dbo].[FgRegulatoryProfile]([itemId]);
CREATE NONCLUSTERED INDEX [FgRegulatoryProfile_tenantId_idx] ON [dbo].[FgRegulatoryProfile]([tenantId]);
CREATE UNIQUE NONCLUSTERED INDEX [FgIfraLevel_profileId_category_key] ON [dbo].[FgIfraLevel]([profileId], [category]);
CREATE NONCLUSTERED INDEX [FgIfraLevel_tenantId_idx] ON [dbo].[FgIfraLevel]([tenantId]);

-- AddForeignKey
ALTER TABLE [dbo].[FgRegulatoryProfile] ADD CONSTRAINT [FgRegulatoryProfile_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FgRegulatoryProfile] ADD CONSTRAINT [FgRegulatoryProfile_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FgIfraLevel] ADD CONSTRAINT [FgIfraLevel_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FgIfraLevel] ADD CONSTRAINT [FgIfraLevel_profileId_fkey] FOREIGN KEY ([profileId]) REFERENCES [dbo].[FgRegulatoryProfile]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Guardrails (columns created this batch -> EXEC the constraints).
EXEC('ALTER TABLE [dbo].[FgRegulatoryProfile] ADD CONSTRAINT [FgRegulatoryProfile_complianceStatus_allowed] CHECK ([complianceStatus] IN (''UNKNOWN'', ''COMPLIANT'', ''NON_COMPLIANT'', ''PENDING''))');
EXEC('ALTER TABLE [dbo].[FgIfraLevel] ADD CONSTRAINT [FgIfraLevel_maxPercent_range] CHECK ([maxPercent] >= 0 AND [maxPercent] <= 100)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

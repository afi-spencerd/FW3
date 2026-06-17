BEGIN TRY

BEGIN TRAN;

-- Location: typed-level tree (BUILDING -> AISLE -> RACK, plus AREA) with a full
-- composed code. New columns first (defaults backfill existing rows as AREAs).
ALTER TABLE [dbo].[Location] ADD
    [kind] NVARCHAR(10) NOT NULL CONSTRAINT [Location_kind_df] DEFAULT 'AREA',
    [parentId] CHAR(36) NULL,
    [buildingId] CHAR(36) NULL,
    [segment] NVARCHAR(20) NOT NULL CONSTRAINT [Location_segment_df] DEFAULT '',
    [side] NVARCHAR(8) NULL;

-- code becomes the full composed address: widen + make NOT NULL with a default.
UPDATE [dbo].[Location] SET [code] = '' WHERE [code] IS NULL;
ALTER TABLE [dbo].[Location] ALTER COLUMN [code] NVARCHAR(40) NOT NULL;
ALTER TABLE [dbo].[Location] ADD CONSTRAINT [Location_code_df] DEFAULT '' FOR [code];

-- kind guardrail (column added this batch -> EXEC).
EXEC('ALTER TABLE [dbo].[Location] ADD CONSTRAINT [Location_kind_allowed] CHECK ([kind] IN (''BUILDING'', ''AISLE'', ''RACK'', ''AREA''))');

-- Names repeat across buildings (e.g. "Receiving"); the full code is the unique key.
ALTER TABLE [dbo].[Location] DROP CONSTRAINT [Location_tenantId_name_key];
ALTER TABLE [dbo].[Location] ADD CONSTRAINT [Location_tenantId_code_key] UNIQUE NONCLUSTERED ([tenantId], [code]);

-- Self relations.
ALTER TABLE [dbo].[Location] ADD CONSTRAINT [Location_parentId_fkey] FOREIGN KEY ([parentId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Location] ADD CONSTRAINT [Location_buildingId_fkey] FOREIGN KEY ([buildingId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE NONCLUSTERED INDEX [Location_parentId_idx] ON [dbo].[Location]([parentId]);
CREATE NONCLUSTERED INDEX [Location_buildingId_idx] ON [dbo].[Location]([buildingId]);

-- Default/receiving are now scoped per building, not per tenant.
DROP INDEX [Location_one_default_per_tenant] ON [dbo].[Location];
DROP INDEX [Location_one_receiving_per_tenant] ON [dbo].[Location];
CREATE UNIQUE NONCLUSTERED INDEX [Location_one_default_per_building] ON [dbo].[Location]([buildingId]) WHERE [isDefault] = 1;
CREATE UNIQUE NONCLUSTERED INDEX [Location_one_receiving_per_building] ON [dbo].[Location]([buildingId]) WHERE [isReceiving] = 1;

-- A lot remembers where it was quarantined, so QC approval routes to that
-- building's default storage.
ALTER TABLE [dbo].[ReceivedLot] ADD [locationId] CHAR(36) NULL;
ALTER TABLE [dbo].[ReceivedLot] ADD CONSTRAINT [ReceivedLot_locationId_fkey] FOREIGN KEY ([locationId]) REFERENCES [dbo].[Location]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

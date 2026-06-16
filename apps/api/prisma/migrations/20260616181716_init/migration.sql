BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Tenant] (
    [id] CHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [slug] NVARCHAR(100) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Tenant_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Tenant_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Tenant_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [idpSub] NVARCHAR(255) NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [User_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_tenantId_idpSub_key] UNIQUE NONCLUSTERED ([tenantId],[idpSub]),
    CONSTRAINT [User_tenantId_email_key] UNIQUE NONCLUSTERED ([tenantId],[email])
);

-- CreateTable
CREATE TABLE [dbo].[Role] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Role_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Role_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Role_tenantId_name_key] UNIQUE NONCLUSTERED ([tenantId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[Permission] (
    [id] CHAR(36) NOT NULL,
    [key] NVARCHAR(100) NOT NULL,
    CONSTRAINT [Permission_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Permission_key_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[RolePermission] (
    [roleId] CHAR(36) NOT NULL,
    [permissionId] CHAR(36) NOT NULL,
    CONSTRAINT [RolePermission_pkey] PRIMARY KEY CLUSTERED ([roleId],[permissionId])
);

-- CreateTable
CREATE TABLE [dbo].[UserRole] (
    [userId] CHAR(36) NOT NULL,
    [roleId] CHAR(36) NOT NULL,
    CONSTRAINT [UserRole_pkey] PRIMARY KEY CLUSTERED ([userId],[roleId])
);

-- CreateTable
CREATE TABLE [dbo].[InventoryItem] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [sku] NVARCHAR(64) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [unitOfMeasure] NVARCHAR(16) NOT NULL CONSTRAINT [InventoryItem_unitOfMeasure_df] DEFAULT 'EA',
    [quantityOnHand] DECIMAL(18,4) NOT NULL CONSTRAINT [InventoryItem_quantityOnHand_df] DEFAULT 0,
    [unitCost] DECIMAL(19,4) NOT NULL CONSTRAINT [InventoryItem_unitCost_df] DEFAULT 0,
    [salesPrice] DECIMAL(19,4) NOT NULL CONSTRAINT [InventoryItem_salesPrice_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [InventoryItem_active_df] DEFAULT 1,
    [qbListId] NVARCHAR(64),
    [qbEditSequence] NVARCHAR(64),
    [qbSyncedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InventoryItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [InventoryItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [InventoryItem_tenantId_sku_key] UNIQUE NONCLUSTERED ([tenantId],[sku])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [actorId] CHAR(36),
    [entityType] NVARCHAR(100) NOT NULL,
    [entityId] NVARCHAR(64) NOT NULL,
    [action] NVARCHAR(50) NOT NULL,
    [before] NVARCHAR(max),
    [after] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[QbConnection] (
    [id] CHAR(36) NOT NULL,
    [tenantId] CHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [qbwcUsername] NVARCHAR(100) NOT NULL,
    [qbwcPasswordHash] NVARCHAR(255) NOT NULL,
    [companyFile] NVARCHAR(500),
    [lastSyncAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QbConnection_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [QbConnection_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QbConnection_qbwcUsername_key] UNIQUE NONCLUSTERED ([qbwcUsername])
);

-- CreateTable
CREATE TABLE [dbo].[QbwcSession] (
    [id] CHAR(36) NOT NULL,
    [connectionId] CHAR(36) NOT NULL,
    [ticket] NVARCHAR(100) NOT NULL,
    [status] NVARCHAR(50) NOT NULL,
    [lastError] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QbwcSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [QbwcSession_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QbwcSession_ticket_key] UNIQUE NONCLUSTERED ([ticket])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_tenantId_idx] ON [dbo].[User]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Role_tenantId_idx] ON [dbo].[Role]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RolePermission_permissionId_idx] ON [dbo].[RolePermission]([permissionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserRole_roleId_idx] ON [dbo].[UserRole]([roleId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryItem_tenantId_idx] ON [dbo].[InventoryItem]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_tenantId_entityType_entityId_idx] ON [dbo].[AuditLog]([tenantId], [entityType], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_tenantId_createdAt_idx] ON [dbo].[AuditLog]([tenantId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [QbConnection_tenantId_idx] ON [dbo].[QbConnection]([tenantId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [QbwcSession_connectionId_idx] ON [dbo].[QbwcSession]([connectionId]);

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Role] ADD CONSTRAINT [Role_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_permissionId_fkey] FOREIGN KEY ([permissionId]) REFERENCES [dbo].[Permission]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserRole] ADD CONSTRAINT [UserRole_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserRole] ADD CONSTRAINT [UserRole_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[QbConnection] ADD CONSTRAINT [QbConnection_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[QbwcSession] ADD CONSTRAINT [QbwcSession_connectionId_fkey] FOREIGN KEY ([connectionId]) REFERENCES [dbo].[QbConnection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Financial-safety guardrails enforced at the DB level (not app code alone):
-- money and quantity may never go negative.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_quantityOnHand_nonneg] CHECK ([quantityOnHand] >= 0);
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_unitCost_nonneg] CHECK ([unitCost] >= 0);
ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_salesPrice_nonneg] CHECK ([salesPrice] >= 0);

-- ---------------------------------------------------------------------------
-- Valuation views: heavy aggregation pushed down into SQL Server (the ~10%
-- analytical path). Wrapped in EXEC() because CREATE VIEW must be the first
-- statement of its batch and this migration runs as a single batch.
-- ---------------------------------------------------------------------------
EXEC('CREATE VIEW [dbo].[vw_InventoryValuation] AS
SELECT
    i.[tenantId]                                            AS tenantId,
    i.[id]                                                  AS itemId,
    i.[sku]                                                 AS sku,
    i.[name]                                                AS name,
    i.[quantityOnHand]                                      AS quantityOnHand,
    i.[unitCost]                                            AS unitCost,
    CAST(i.[quantityOnHand] * i.[unitCost] AS DECIMAL(38,4)) AS extendedValue,
    i.[active]                                              AS active
FROM [dbo].[InventoryItem] i;');

EXEC('CREATE VIEW [dbo].[vw_InventoryValuationByTenant] AS
SELECT
    i.[tenantId]                                                  AS tenantId,
    COUNT_BIG(*)                                                  AS itemCount,
    CAST(SUM(i.[quantityOnHand]) AS DECIMAL(38,4))                AS totalQuantity,
    CAST(SUM(i.[quantityOnHand] * i.[unitCost]) AS DECIMAL(38,4)) AS totalValue
FROM [dbo].[InventoryItem] i
WHERE i.[active] = 1
GROUP BY i.[tenantId];');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

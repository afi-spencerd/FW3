BEGIN TRY

BEGIN TRAN;

-- Item master gains QuickBooks attributes.
ALTER TABLE [dbo].[InventoryItem] ADD
    [qbItemType] NVARCHAR(20) NOT NULL CONSTRAINT [InventoryItem_qbItemType_df] DEFAULT 'INVENTORY',
    [standardCost] DECIMAL(19,4) NOT NULL CONSTRAINT [InventoryItem_standardCost_df] DEFAULT 0,
    [purchaseDescription] NVARCHAR(2000),
    [incomeAccount] NVARCHAR(159),
    [cogsAccount] NVARCHAR(159),
    [assetAccount] NVARCHAR(159);

-- Column added this batch -> EXEC the CHECK.
EXEC('ALTER TABLE [dbo].[InventoryItem] ADD CONSTRAINT [InventoryItem_qbItemType_allowed] CHECK ([qbItemType] IN (''INVENTORY'', ''NON_INVENTORY'', ''SERVICE''))');

-- Separate inventory position from the item master: the valuation views now read
-- the stock ledger (ItemStock, INV bucket) instead of columns on InventoryItem.
DROP VIEW [dbo].[vw_InventoryValuationByTenant];
DROP VIEW [dbo].[vw_InventoryValuation];

EXEC('CREATE VIEW [dbo].[vw_InventoryValuation] AS
SELECT
    i.[tenantId]                                              AS tenantId,
    i.[id]                                                    AS itemId,
    i.[sku]                                                   AS sku,
    i.[name]                                                  AS name,
    CAST(COALESCE(s.[quantity], 0) AS DECIMAL(18,4))          AS quantityOnHand,
    CAST(COALESCE(s.[avgCost], 0) AS DECIMAL(19,4))           AS unitCost,
    CAST(COALESCE(s.[quantity], 0) * COALESCE(s.[avgCost], 0) AS DECIMAL(38,4)) AS extendedValue,
    i.[active]                                                AS active
FROM [dbo].[InventoryItem] i
LEFT JOIN [dbo].[ItemStock] s ON s.[itemId] = i.[id] AND s.[state] = ''INV'';');

EXEC('CREATE VIEW [dbo].[vw_InventoryValuationByTenant] AS
SELECT
    i.[tenantId]                                                  AS tenantId,
    COUNT_BIG(*)                                                  AS itemCount,
    CAST(SUM(COALESCE(s.[quantity], 0)) AS DECIMAL(38,4))         AS totalQuantity,
    CAST(SUM(COALESCE(s.[quantity], 0) * COALESCE(s.[avgCost], 0)) AS DECIMAL(38,4)) AS totalValue
FROM [dbo].[InventoryItem] i
LEFT JOIN [dbo].[ItemStock] s ON s.[itemId] = i.[id] AND s.[state] = ''INV''
WHERE i.[active] = 1
GROUP BY i.[tenantId];');

-- Drop the inventory-position columns from the item master.
ALTER TABLE [dbo].[InventoryItem] DROP CONSTRAINT [InventoryItem_quantityOnHand_nonneg];
ALTER TABLE [dbo].[InventoryItem] DROP CONSTRAINT [InventoryItem_unitCost_nonneg];
ALTER TABLE [dbo].[InventoryItem] DROP CONSTRAINT [InventoryItem_quantityOnHand_df];
ALTER TABLE [dbo].[InventoryItem] DROP CONSTRAINT [InventoryItem_unitCost_df];
ALTER TABLE [dbo].[InventoryItem] DROP COLUMN [quantityOnHand];
ALTER TABLE [dbo].[InventoryItem] DROP COLUMN [unitCost];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

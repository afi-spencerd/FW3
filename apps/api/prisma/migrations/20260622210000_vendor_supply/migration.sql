BEGIN TRY

BEGIN TRAN;

-- AlterTable: what each vendor supplies (drives PO-page line options).
ALTER TABLE [dbo].[Vendor] ADD
    [suppliesMaterials] BIT NOT NULL CONSTRAINT [Vendor_suppliesMaterials_df] DEFAULT 1,
    [suppliesContainers] BIT NOT NULL CONSTRAINT [Vendor_suppliesContainers_df] DEFAULT 0;

-- Backfill from prior purchase history so existing vendors start out right:
-- mark container-supplying vendors, and clear materials for container-only ones.
-- EXEC-wrapped: the columns are added in this same batch, so deferred compile.
EXEC('UPDATE V SET [suppliesContainers] = 1
FROM [dbo].[Vendor] V
WHERE EXISTS (
  SELECT 1 FROM [dbo].[PurchaseOrder] po
  JOIN [dbo].[PurchaseOrderLine] pol ON pol.[purchaseOrderId] = po.[id]
  WHERE po.[vendorId] = V.[id] AND pol.[containerId] IS NOT NULL
)');

EXEC('UPDATE V SET [suppliesMaterials] = 0
FROM [dbo].[Vendor] V
WHERE EXISTS (
  SELECT 1 FROM [dbo].[PurchaseOrder] po
  JOIN [dbo].[PurchaseOrderLine] pol ON pol.[purchaseOrderId] = po.[id]
  WHERE po.[vendorId] = V.[id] AND pol.[containerId] IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM [dbo].[PurchaseOrder] po2
  JOIN [dbo].[PurchaseOrderLine] pol2 ON pol2.[purchaseOrderId] = po2.[id]
  WHERE po2.[vendorId] = V.[id] AND pol2.[itemId] IS NOT NULL
)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

BEGIN TRY

BEGIN TRAN;

-- A PO line can now buy a container instead of an item. Make itemId nullable
-- (drop + re-add its FK around the ALTER) and add a containerId line subject.
ALTER TABLE [dbo].[PurchaseOrderLine] DROP CONSTRAINT [PurchaseOrderLine_itemId_fkey];
ALTER TABLE [dbo].[PurchaseOrderLine] ALTER COLUMN [itemId] CHAR(36) NULL;
ALTER TABLE [dbo].[PurchaseOrderLine] ADD [containerId] CHAR(36);

ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[InventoryItem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_containerId_fkey] FOREIGN KEY ([containerId]) REFERENCES [dbo].[Container]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE NONCLUSTERED INDEX [PurchaseOrderLine_containerId_idx] ON [dbo].[PurchaseOrderLine]([containerId]);

-- Exactly one subject per line: an item or a container, never both/neither.
EXEC('ALTER TABLE [dbo].[PurchaseOrderLine] ADD CONSTRAINT [PurchaseOrderLine_subject_one] CHECK ((CASE WHEN [itemId] IS NULL THEN 0 ELSE 1 END) + (CASE WHEN [containerId] IS NULL THEN 0 ELSE 1 END) = 1)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

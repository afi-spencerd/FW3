BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Customer] ADD [notes] NVARCHAR(2000),
[phone] NVARCHAR(50),
[website] NVARCHAR(200);

-- AlterTable
ALTER TABLE [dbo].[Vendor] ADD [notes] NVARCHAR(2000),
[phone] NVARCHAR(50),
[website] NVARCHAR(200);

-- CreateTable
CREATE TABLE [dbo].[VendorAddress] (
    [id] CHAR(36) NOT NULL,
    [vendorId] CHAR(36) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL CONSTRAINT [VendorAddress_kind_df] DEFAULT 'OTHER',
    [label] NVARCHAR(100),
    [line1] NVARCHAR(200) NOT NULL,
    [line2] NVARCHAR(200),
    [city] NVARCHAR(100),
    [region] NVARCHAR(100),
    [postalCode] NVARCHAR(20),
    [country] NVARCHAR(100),
    [isPrimary] BIT NOT NULL CONSTRAINT [VendorAddress_isPrimary_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [VendorAddress_sortOrder_df] DEFAULT 0,
    CONSTRAINT [VendorAddress_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[VendorContact] (
    [id] CHAR(36) NOT NULL,
    [vendorId] CHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [title] NVARCHAR(100),
    [email] NVARCHAR(320),
    [phone] NVARCHAR(50),
    [isPrimary] BIT NOT NULL CONSTRAINT [VendorContact_isPrimary_df] DEFAULT 0,
    [notes] NVARCHAR(500),
    [sortOrder] INT NOT NULL CONSTRAINT [VendorContact_sortOrder_df] DEFAULT 0,
    CONSTRAINT [VendorContact_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CustomerAddress] (
    [id] CHAR(36) NOT NULL,
    [customerId] CHAR(36) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL CONSTRAINT [CustomerAddress_kind_df] DEFAULT 'OTHER',
    [label] NVARCHAR(100),
    [line1] NVARCHAR(200) NOT NULL,
    [line2] NVARCHAR(200),
    [city] NVARCHAR(100),
    [region] NVARCHAR(100),
    [postalCode] NVARCHAR(20),
    [country] NVARCHAR(100),
    [isPrimary] BIT NOT NULL CONSTRAINT [CustomerAddress_isPrimary_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [CustomerAddress_sortOrder_df] DEFAULT 0,
    CONSTRAINT [CustomerAddress_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CustomerContact] (
    [id] CHAR(36) NOT NULL,
    [customerId] CHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [title] NVARCHAR(100),
    [email] NVARCHAR(320),
    [phone] NVARCHAR(50),
    [isPrimary] BIT NOT NULL CONSTRAINT [CustomerContact_isPrimary_df] DEFAULT 0,
    [notes] NVARCHAR(500),
    [sortOrder] INT NOT NULL CONSTRAINT [CustomerContact_sortOrder_df] DEFAULT 0,
    CONSTRAINT [CustomerContact_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [VendorAddress_vendorId_idx] ON [dbo].[VendorAddress]([vendorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [VendorContact_vendorId_idx] ON [dbo].[VendorContact]([vendorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CustomerAddress_customerId_idx] ON [dbo].[CustomerAddress]([customerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CustomerContact_customerId_idx] ON [dbo].[CustomerContact]([customerId]);

-- AddForeignKey
ALTER TABLE [dbo].[VendorAddress] ADD CONSTRAINT [VendorAddress_vendorId_fkey] FOREIGN KEY ([vendorId]) REFERENCES [dbo].[Vendor]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VendorContact] ADD CONSTRAINT [VendorContact_vendorId_fkey] FOREIGN KEY ([vendorId]) REFERENCES [dbo].[Vendor]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CustomerAddress] ADD CONSTRAINT [CustomerAddress_customerId_fkey] FOREIGN KEY ([customerId]) REFERENCES [dbo].[Customer]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CustomerContact] ADD CONSTRAINT [CustomerContact_customerId_fkey] FOREIGN KEY ([customerId]) REFERENCES [dbo].[Customer]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Address kind is a fixed set.
ALTER TABLE [dbo].[VendorAddress] ADD CONSTRAINT [VendorAddress_kind_allowed] CHECK ([kind] IN ('BILLING', 'SHIPPING', 'REMIT_TO', 'OTHER'));
ALTER TABLE [dbo].[CustomerAddress] ADD CONSTRAINT [CustomerAddress_kind_allowed] CHECK ([kind] IN ('BILLING', 'SHIPPING', 'REMIT_TO', 'OTHER'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

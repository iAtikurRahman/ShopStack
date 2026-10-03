-- AlterTable
-- The store's picture. The bytes live on disk under
-- public/uploads/company-<companyId>/stores/; this column only holds the
-- public path that gets served back. Null means the store has no image yet,
-- so every existing row keeps working unchanged.
ALTER TABLE `Store` ADD COLUMN `imageUrl` VARCHAR(191) NULL;
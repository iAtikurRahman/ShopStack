/*
  Unit-of-measure support.

  Every quantity column becomes DECIMAL(14,2) so measured goods can be kept
  fractionally (2.5 kg of rice, 0.75 litre of oil). Each transaction line also
  gains:
    - `unit`          the unit the line was entered in (piece/kg/litre/mon/...)
    - `stockQuantity` the same quantity converted to the product's stock unit,
                      which is what inventory and reports use.

  Existing rows predate units, so their quantity is already in the product's
  stock unit; the UPDATE statements below mark it as such so history stays
  correct. See src/lib/units.ts for the conversion model.
*/

-- AlterTable
ALTER TABLE `PurchaseItem` ADD COLUMN `stockQuantity` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `unit` VARCHAR(191) NULL,
    MODIFY `quantity` DECIMAL(14, 2) NOT NULL;

-- AlterTable
ALTER TABLE `ReturnItem` ADD COLUMN `stockQuantity` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `unit` VARCHAR(191) NULL,
    MODIFY `quantity` DECIMAL(14, 2) NOT NULL;

-- AlterTable
ALTER TABLE `SaleItem` ADD COLUMN `stockQuantity` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `unit` VARCHAR(191) NULL,
    MODIFY `quantity` DECIMAL(14, 2) NOT NULL;

-- AlterTable
ALTER TABLE `StockTransferItem` ADD COLUMN `stockQuantity` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `unit` VARCHAR(191) NULL,
    MODIFY `quantity` DECIMAL(14, 2) NOT NULL;

-- AlterTable
ALTER TABLE `SupplierReturn` ADD COLUMN `stockQuantity` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `unit` VARCHAR(191) NULL,
    MODIFY `quantity` DECIMAL(14, 2) NOT NULL;

-- AlterTable
ALTER TABLE `WarehouseStock` MODIFY `quantity` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    MODIFY `lowStockThreshold` DECIMAL(14, 2) NOT NULL DEFAULT 5;

-- Backfill: history was written in whole stock units, so copy quantity across
-- and label each line with its product's stock unit (defaulting to piece).
UPDATE `PurchaseItem` pi JOIN `Product` p ON p.id = pi.productId
  SET pi.stockQuantity = pi.quantity, pi.unit = COALESCE(p.unit, 'piece');
UPDATE `SaleItem` si JOIN `Product` p ON p.id = si.productId
  SET si.stockQuantity = si.quantity, si.unit = COALESCE(p.unit, 'piece');
UPDATE `SupplierReturn` sr JOIN `Product` p ON p.id = sr.productId
  SET sr.stockQuantity = sr.quantity, sr.unit = COALESCE(p.unit, 'piece');
UPDATE `StockTransferItem` sti JOIN `Product` p ON p.id = sti.productId
  SET sti.stockQuantity = sti.quantity, sti.unit = COALESCE(p.unit, 'piece');
UPDATE `ReturnItem` ri JOIN `SaleItem` si ON si.id = ri.saleItemId
  SET ri.stockQuantity = ri.quantity, ri.unit = si.unit;

-- DropForeignKey
ALTER TABLE `Purchase` DROP FOREIGN KEY `Purchase_warehouseId_fkey`;

-- DropForeignKey
ALTER TABLE `PurchaseItem` DROP FOREIGN KEY `PurchaseItem_warehouseId_fkey`;

-- AddForeignKey
ALTER TABLE `Purchase` ADD CONSTRAINT `Purchase_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseItem` ADD CONSTRAINT `PurchaseItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

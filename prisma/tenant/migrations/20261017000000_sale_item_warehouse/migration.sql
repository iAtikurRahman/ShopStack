-- A sale can draw the same product from several warehouses, so each SaleItem
-- records the warehouse its own stock left from. Existing lines are backfilled
-- from the warehouse their sale was booked against, so history is preserved.
-- Sale.warehouseId stays as the primary/default warehouse for the sale.
ALTER TABLE `SaleItem` ADD COLUMN `warehouseId` INT NULL;

UPDATE `SaleItem` AS `item`
JOIN `Sale` AS `sale` ON `sale`.`id` = `item`.`saleId`
SET `item`.`warehouseId` = `sale`.`warehouseId`
WHERE `item`.`warehouseId` IS NULL;

ALTER TABLE `SaleItem` ADD INDEX `SaleItem_warehouseId_idx` (`warehouseId`);

ALTER TABLE `SaleItem`
  ADD CONSTRAINT `SaleItem_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

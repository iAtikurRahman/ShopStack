-- A purchase can now feed several warehouses from the same supplier
-- delivery, so each PurchaseItem records where its own goods were put away.
-- Existing lines are backfilled from the warehouse their purchase was booked
-- against, so no history is lost. Purchase.warehouseId stays as the primary
-- warehouse and becomes nullable for purchases whose lines are spread out.
ALTER TABLE `Purchase` MODIFY COLUMN `warehouseId` INT NULL;

ALTER TABLE `PurchaseItem` ADD COLUMN `warehouseId` INT NULL;

UPDATE `PurchaseItem` AS `item`
JOIN `Purchase` AS `purchase` ON `purchase`.`id` = `item`.`purchaseId`
SET `item`.`warehouseId` = `purchase`.`warehouseId`
WHERE `item`.`warehouseId` IS NULL;

ALTER TABLE `PurchaseItem` MODIFY COLUMN `warehouseId` INT NOT NULL;

ALTER TABLE `PurchaseItem` ADD INDEX `PurchaseItem_warehouseId_idx` (`warehouseId`);

ALTER TABLE `PurchaseItem`
  ADD CONSTRAINT `PurchaseItem_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

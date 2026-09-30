-- Track how much money each customer and each supplier still owes, so a
-- running balance can be carried on the party record itself instead of being
-- recomputed from sales/purchases on every page load. Defaults to 0 so every
-- existing row starts at "nothing outstanding".
ALTER TABLE `Customer` ADD COLUMN `dueAmount` DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE `Supplier` ADD COLUMN `dueAmount` DOUBLE NOT NULL DEFAULT 0;

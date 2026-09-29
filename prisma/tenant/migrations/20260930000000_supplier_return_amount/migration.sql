-- Track the credit value expected back from the supplier on each supplier
-- return. Without this the ledger recorded quantity and reason only, so it was
-- impossible to tell how much money a supplier return was worth.
ALTER TABLE `SupplierReturn` ADD COLUMN `amount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

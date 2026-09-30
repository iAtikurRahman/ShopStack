-- How money moves in and out of the till. Adds `due` to the payment methods:
-- nothing was handed over, and the whole amount went onto the party's
-- dueAmount (Customer.dueAmount for a credit sale, Supplier.dueAmount for an
-- unpaid delivery) instead of being recorded as a payment.
--
-- Purchase gains the same column, because a delivery had no way to record how
-- it was being settled. Nullable: rows written before this migration have no
-- recorded method.
ALTER TABLE `SalePayment` MODIFY `method` ENUM('cash', 'card', 'mobile', 'other', 'due') NOT NULL;
ALTER TABLE `Purchase` ADD COLUMN `paymentMethod` ENUM('cash', 'card', 'mobile', 'other', 'due') NULL;

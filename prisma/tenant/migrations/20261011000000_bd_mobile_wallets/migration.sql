-- Split the single generic `mobile` tender into the Bangladeshi MFS providers
-- that actually move money in this market: bKash, Rocket, Nagad, Upay and
-- BanglaQR. Nothing is dropped silently - rows that already say `mobile` are
-- folded into `other` first, which is the honest label for "a wallet, but we
-- did not record which one".
--
-- MySQL will happily truncate a stored value that is no longer in the ENUM on
-- ALTER, so the UPDATEs below have to run BEFORE the MODIFY statements, not
-- after. Today no row carries `mobile`; this is the guard for a database that
-- was seeded before the rename.
UPDATE `SalePayment` SET `method` = 'other' WHERE `method` = 'mobile';
UPDATE `Purchase` SET `paymentMethod` = 'other' WHERE `paymentMethod` = 'mobile';
UPDATE `Payment` SET `paymentType` = 'other' WHERE `paymentType` = 'mobile';

-- MODIFY (not CHANGE) keeps the column's nullability and comment untouched.
ALTER TABLE `SalePayment` MODIFY `method` ENUM('cash', 'card', 'bkash', 'rocket', 'nagad', 'upay', 'banglaqr', 'other', 'due') NOT NULL;
ALTER TABLE `Purchase` MODIFY `paymentMethod` ENUM('cash', 'card', 'bkash', 'rocket', 'nagad', 'upay', 'banglaqr', 'other', 'due') NULL;
ALTER TABLE `Payment` MODIFY `paymentType` ENUM('bank', 'cash', 'bkash', 'rocket', 'nagad', 'upay', 'banglaqr', 'other') NOT NULL;

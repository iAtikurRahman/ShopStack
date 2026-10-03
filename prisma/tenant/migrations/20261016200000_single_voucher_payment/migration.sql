-- The payment is made once for the whole voucher, not per line.
--
-- The heads say what the money was spent on; only after they have all been added
-- up is there a single answer to "how was this paid". So isPaid and paymentMethod
-- move up from ExpenditureItem to Expenditure, and the voucher-level extrasPaid /
-- extrasPaymentMethod pair is dropped - it only existed to let the three header
-- extras settle through a different account than the lines, which is not a
-- distinction worth carrying once the voucher has one method.
ALTER TABLE `Expenditure` ADD COLUMN `paymentMethod` VARCHAR(191) NULL;
ALTER TABLE `Expenditure` ADD COLUMN `isPaid` BOOLEAN NOT NULL DEFAULT true;

-- Backfill before the old columns are dropped: they are the only source of the
-- per-line payment information there is.
--
-- A pre-existing voucher was paid line by line, so its account is only known if
-- every paid line named the SAME one. COUNT(DISTINCT ...) <= 1 is what enforces
-- that - a voucher whose paid lines were split across two accounts has no single
-- answer, so it is left without one and marked unpaid below rather than being
-- silently re-pointed at an arbitrary account. A wrong balance is worse than an
-- unpaid one, and the owner settles it with one edit.
UPDATE `Expenditure` AS e
SET
  `paymentMethod` = (
    SELECT MIN(i.`paymentMethod`)
    FROM `ExpenditureItem` AS i
    WHERE i.`expenditureId` = e.`id`
      AND i.`isPaid` = true
      AND i.`paymentMethod` IS NOT NULL
  ),
  `isPaid` = CASE WHEN EXISTS (
    SELECT 1
    FROM `ExpenditureItem` AS i
    WHERE i.`expenditureId` = e.`id`
      AND i.`isPaid` = true
      AND i.`paymentMethod` IS NOT NULL
  ) THEN true ELSE false END
WHERE (
  SELECT COUNT(DISTINCT i2.`paymentMethod`)
  FROM `ExpenditureItem` AS i2
  WHERE i2.`expenditureId` = e.`id`
    AND i2.`isPaid` = true
    AND i2.`paymentMethod` IS NOT NULL
) <= 1;

-- Anything still unpaid, or paid with no single account to point at, stays
-- unpaid: paidAmount 0 so it cannot claim money that never moved.
UPDATE `Expenditure`
SET `isPaid` = false, `paidAmount` = 0
WHERE `isPaid` = false
   OR `paymentMethod` IS NULL;

-- A settled voucher's paidAmount is its total, now that one account covers the
-- whole voucher rather than a sum of per-line amounts.
UPDATE `Expenditure`
SET `paidAmount` = GREATEST(`totalAmount`, 0)
WHERE `isPaid` = true;

ALTER TABLE `Expenditure` DROP COLUMN `extrasPaid`;
ALTER TABLE `Expenditure` DROP COLUMN `extrasPaymentMethod`;

ALTER TABLE `ExpenditureItem` DROP COLUMN `paymentMethod`;
ALTER TABLE `ExpenditureItem` DROP COLUMN `isPaid`;

-- No DROP INDEX for ExpenditureItem_paymentMethod_idx: dropping the column above
-- already drops the index that was on it, and asking MySQL to drop it a second
-- time fails with "check that column/key exists".

-- One account per voucher, so this is now the only place worth indexing it on.
CREATE INDEX `Expenditure_paymentMethod_idx` ON `Expenditure`(`paymentMethod`);
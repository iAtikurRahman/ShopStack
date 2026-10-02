-- CreateTable
CREATE TABLE `bank_info` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bankName` VARCHAR(191) NOT NULL,
    `initialBalance` DOUBLE NOT NULL DEFAULT 0,
    `remainingBalance` DOUBLE NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bank_info_bankName_key`(`bankName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the accounts the two hard-coded enums used to spell out
-- (PaymentMethod: cash/card/bkash/rocket/nagad/upay/banglaqr/other,
--  PaymentType: bank/cash/bkash/rocket/nagad/upay/banglaqr/other), so every
-- row those columns already carry resolves to a real account the moment this
-- migration lands. `due` is deliberately absent - it is the "nothing was paid"
-- marker, not an account, and no money ever moves through it.
--
-- Balances start at 0 rather than being back-dated: the running figure has only
-- been tracked from here on, so any owner with existing money in hand sets
-- initialBalance/remainingBalance by hand on the Banks screen. Guessing a
-- back-date would silently inflate every balance sheet drawn afterwards.
INSERT INTO `bank_info` (`bankName`, `initialBalance`, `remainingBalance`, `isActive`, `createdAt`, `updatedAt`) VALUES
    ('cash', 0, 0, true, NOW(3), NOW(3)),
    ('card', 0, 0, true, NOW(3), NOW(3)),
    ('bank', 0, 0, true, NOW(3), NOW(3)),
    ('bkash', 0, 0, true, NOW(3), NOW(3)),
    ('rocket', 0, 0, true, NOW(3), NOW(3)),
    ('nagad', 0, 0, true, NOW(3), NOW(3)),
    ('upay', 0, 0, true, NOW(3), NOW(3)),
    ('banglaqr', 0, 0, true, NOW(3), NOW(3)),
    ('other', 0, 0, true, NOW(3), NOW(3));

-- AlterTable
ALTER TABLE `payment` MODIFY `paymentType` VARCHAR(191) NOT NULL;
ALTER TABLE `purchase` MODIFY `paymentMethod` VARCHAR(191) NULL;
ALTER TABLE `salepayment` MODIFY `method` VARCHAR(191) NOT NULL;

-- Money movements against a customer or a supplier: the ledger that
-- Customer.dueAmount / Supplier.dueAmount (added in 20261007000000) is
-- maintained from. "receive" takes in what a customer owes, "payment" pays
-- out what we owe a supplier. Both sides live in one table, so the party id
-- is a loose int qualified by `type` rather than a foreign key.
--
-- transactionId is UNIQUE so the same external transaction (receipt no, bank
-- reference) can never be booked twice - that is what stops a double-submitted
-- form from posting the money again.
CREATE TABLE `Payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transactionId` VARCHAR(191) NOT NULL,
    `transactionType` ENUM('payment', 'receive') NOT NULL,
    `paymentType` ENUM('bank', 'cash', 'mobile', 'other') NOT NULL,
    `type` ENUM('customer', 'supplier') NOT NULL,
    `customerSupplierId` INTEGER NOT NULL,
    `paymentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `paymentAmount` DOUBLE NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Payment_transactionId_key`(`transactionId`),
    INDEX `Payment_type_customerSupplierId_idx`(`type`, `customerSupplierId`),
    INDEX `Payment_paymentDate_idx`(`paymentDate`),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

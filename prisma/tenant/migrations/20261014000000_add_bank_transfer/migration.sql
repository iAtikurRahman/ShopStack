-- CreateTable
CREATE TABLE `BankTransfer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fromBankId` INTEGER NOT NULL,
    `toBankId` INTEGER NOT NULL,
    `amount` DOUBLE NOT NULL,
    `remarks` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BankTransfer_fromBankId_idx`(`fromBankId`),
    INDEX `BankTransfer_toBankId_idx`(`toBankId`),
    INDEX `BankTransfer_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    -- RESTRICT on both sides: a transfer is history that has already moved two
    -- balances, so neither account can be deleted while it still names them.
    -- Deactivating the account is the reversible answer, the same one
    -- deleteBank offers for a sale or a payment.
    CONSTRAINT `BankTransfer_fromBankId_fkey` FOREIGN KEY (`fromBankId`) REFERENCES `bank_info`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `BankTransfer_toBankId_fkey` FOREIGN KEY (`toBankId`) REFERENCES `bank_info`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

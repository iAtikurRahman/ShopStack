-- CreateTable
CREATE TABLE `Withdrawal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bankId` INTEGER NOT NULL,
    `withdrawalDate` DATETIME(3) NOT NULL,
    `personName` VARCHAR(191) NOT NULL,
    `accountOrMobile` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `reason` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Withdrawal_bankId_idx`(`bankId`),
    INDEX `Withdrawal_withdrawalDate_idx`(`withdrawalDate`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Withdrawal_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `bank_info`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

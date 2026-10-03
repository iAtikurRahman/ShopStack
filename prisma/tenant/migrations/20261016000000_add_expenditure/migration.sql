-- CreateTable
CREATE TABLE `ExpenditureHead` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ExpenditureHead_isActive_idx`(`isActive`),
    UNIQUE INDEX `ExpenditureHead_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expenditure` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `expenditureDate` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `transportationCost` DOUBLE NOT NULL DEFAULT 0,
    `additionalCost` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Expenditure_createdAt_idx`(`createdAt`),
    INDEX `Expenditure_expenditureDate_idx`(`expenditureDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenditureItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `expenditureId` INTEGER NOT NULL,
    `headId` INTEGER NOT NULL,
    `description` VARCHAR(191) NULL,
    `billNo` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `isPaid` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExpenditureItem_expenditureId_idx`(`expenditureId`),
    INDEX `ExpenditureItem_headId_idx`(`headId`),
    INDEX `ExpenditureItem_paymentMethod_idx`(`paymentMethod`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ExpenditureItem_expenditureId_fkey` FOREIGN KEY (`expenditureId`) REFERENCES `Expenditure`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `ExpenditureItem_headId_fkey` FOREIGN KEY (`headId`) REFERENCES `ExpenditureHead`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A starter vocabulary so a tenant that already exists does not open the
-- Expenditure screen to an empty dropdown and conclude the feature is broken.
-- Mirrors what provisionCompany() seeds for a brand new tenant, and the same
-- list lives in src/lib/expenditures.ts (DEFAULT_EXPENDITURE_HEADS) - the
-- duplication is deliberate, exactly as it is for bank_info above: this file
-- has to be plain SQL because it runs inside the migration engine.
--
-- Everything here is ordinary running cost and can be deactivated from the
-- Expenditure screen; nothing is mandatory and the owner can add their own.
INSERT INTO `ExpenditureHead` (`name`, `isActive`, `createdAt`, `updatedAt`) VALUES
    ('Salary', true, NOW(3), NOW(3)),
    ('Rent', true, NOW(3), NOW(3)),
    ('Electricity', true, NOW(3), NOW(3)),
    ('Gas', true, NOW(3), NOW(3)),
    ('Internet', true, NOW(3), NOW(3)),
    ('Transportation', true, NOW(3), NOW(3)),
    ('Entertainment', true, NOW(3), NOW(3)),
    ('Office Supplies', true, NOW(3), NOW(3)),
    ('Repairs and Maintenance', true, NOW(3), NOW(3)),
    ('Bank Charge', true, NOW(3), NOW(3)),
    ('Others', true, NOW(3), NOW(3));
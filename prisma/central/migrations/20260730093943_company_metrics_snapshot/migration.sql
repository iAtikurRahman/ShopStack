-- CreateTable
CREATE TABLE `CompanyMetricsSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `totalSales` DECIMAL(14, 2) NOT NULL,
    `totalRefunds` DECIMAL(14, 2) NOT NULL,
    `salesCount` INTEGER NOT NULL,
    `storeCount` INTEGER NOT NULL,
    `userCount` INTEGER NOT NULL,
    `refreshedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CompanyMetricsSnapshot_companyId_key`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CompanyMetricsSnapshot` ADD CONSTRAINT `CompanyMetricsSnapshot_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

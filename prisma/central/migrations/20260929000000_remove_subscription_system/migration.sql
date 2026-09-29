-- Removes the premium/subscription and advertisement systems entirely.
-- Every company is now unconditionally full-featured, so there is nothing
-- left to gate on and the tables (plus the payment history in them) are gone.
-- Drop order matters: children first, since the FKs above are RESTRICT.

-- DropForeignKey
ALTER TABLE `SubscriptionPayment` DROP FOREIGN KEY `SubscriptionPayment_subscriptionId_fkey`;

-- DropForeignKey
ALTER TABLE `SubscriptionPayment` DROP FOREIGN KEY `SubscriptionPayment_companyId_fkey`;

-- DropForeignKey
ALTER TABLE `SubscriptionPayment` DROP FOREIGN KEY `SubscriptionPayment_planId_fkey`;

-- DropForeignKey
ALTER TABLE `Subscription` DROP FOREIGN KEY `Subscription_companyId_fkey`;

-- DropForeignKey
ALTER TABLE `Subscription` DROP FOREIGN KEY `Subscription_planId_fkey`;

-- DropForeignKey
ALTER TABLE `Notification` DROP FOREIGN KEY `Notification_companyId_fkey`;

-- DropTable
DROP TABLE `SubscriptionPayment`;

-- DropTable
DROP TABLE `Subscription`;

-- DropTable
DROP TABLE `SubscriptionPlan`;

-- DropTable
DROP TABLE `PaymentMethodConfig`;

-- DropTable
DROP TABLE `AdvertisementSettings`;

-- DropTable
DROP TABLE `Notification`;

-- The three optional header extras (transportation / additional / discount) move
-- money as one signed figure, and that figure has to be reversible. Voiding a
-- voucher puts the money back on the account it left, so the account and the
-- settled/not-settled decision have to be stored rather than inferred - once the
-- lines have been edited there is nothing left to infer them from.
ALTER TABLE `Expenditure` ADD COLUMN `extrasPaid` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Expenditure` ADD COLUMN `extrasPaymentMethod` VARCHAR(191) NULL;
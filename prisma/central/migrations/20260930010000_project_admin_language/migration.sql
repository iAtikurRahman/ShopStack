-- Project admin accounts remember their chosen UI language too, so the
-- platform console comes back in the same language after a re-login.
ALTER TABLE `ProjectAdmin` ADD COLUMN `language` VARCHAR(191) NOT NULL DEFAULT 'en';

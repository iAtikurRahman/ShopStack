-- Each account remembers the UI language it last chose, so signing in again
-- restores it without the user hunting for the switcher. Copied into the
-- signed session token at login and refreshed whenever it is changed.
ALTER TABLE `User` ADD COLUMN `language` VARCHAR(191) NOT NULL DEFAULT 'en';

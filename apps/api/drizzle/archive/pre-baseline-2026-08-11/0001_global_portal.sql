ALTER TABLE `portal_settings` DROP FOREIGN KEY `portal_settings_venue_id_venues_id_fk`;
--> statement-breakpoint
ALTER TABLE `portal_settings` DROP INDEX `portal_settings_venue_id_unique`;
--> statement-breakpoint
ALTER TABLE `portal_settings` DROP COLUMN `venue_id`;

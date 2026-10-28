-- Durations become whole MINUTES instead of whole hours.
--
-- `duration_hours` was an int, so the shortest package expressible was one hour — and a 30-minute
-- bundle is the cheapest and most common thing a Tanzanian hotspot sells. Minutes is the smallest
-- unit worth storing: RouterOS `limit-uptime` is [Nd]HH:MM:SS, so the hardware enforces it directly
-- (§13.6), and nothing in this system prices below a minute.
--
-- Both tables carry the column. `packages.duration_hours` is NOT NULL; `vouchers.duration_hours` is
-- nullable (a voucher inherits the package's duration when its own is null), so the new column
-- keeps that nullability exactly.
--
-- Add → backfill → tighten → drop, rather than a bare RENAME, so the multiplication happens while
-- both columns exist and no row is left holding hours under a column named minutes.

ALTER TABLE `packages` ADD COLUMN `duration_minutes` int NULL;
--> statement-breakpoint
UPDATE `packages` SET `duration_minutes` = `duration_hours` * 60;
--> statement-breakpoint
ALTER TABLE `packages` MODIFY COLUMN `duration_minutes` int NOT NULL;
--> statement-breakpoint
ALTER TABLE `packages` DROP COLUMN `duration_hours`;
--> statement-breakpoint
ALTER TABLE `vouchers` ADD COLUMN `duration_minutes` int NULL;
--> statement-breakpoint
UPDATE `vouchers` SET `duration_minutes` = `duration_hours` * 60;
--> statement-breakpoint
ALTER TABLE `vouchers` DROP COLUMN `duration_hours`;

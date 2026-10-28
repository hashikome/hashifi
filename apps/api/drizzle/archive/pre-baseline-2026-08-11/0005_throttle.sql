ALTER TABLE `packages`
  ADD COLUMN `throttled_download_mbps` int DEFAULT NULL,
  ADD COLUMN `throttled_upload_mbps` int DEFAULT NULL,
  ADD COLUMN `peak_start_hour` int DEFAULT NULL,
  ADD COLUMN `peak_end_hour` int DEFAULT NULL,
  ADD COLUMN `throttle_after_gb` int DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `wifi_sessions`
  ADD COLUMN `is_throttled` boolean NOT NULL DEFAULT false;

CREATE TABLE `admin_otp_codes` (
	`id` varchar(36) NOT NULL,
	`admin_user_id` varchar(36) NOT NULL,
	`code_hash` varchar(255) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_otp_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_preferences` (
	`id` varchar(36) NOT NULL,
	`admin_user_id` varchar(36) NOT NULL,
	`theme` enum('light','dark','system') NOT NULL DEFAULT 'system',
	`email_notifications` boolean NOT NULL DEFAULT true,
	`push_notifications` boolean NOT NULL DEFAULT true,
	`session_alerts` boolean NOT NULL DEFAULT true,
	`security_alerts` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_preferences_admin_user_id_unique` UNIQUE(`admin_user_id`)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` varchar(36) NOT NULL,
	`admin_user_id` varchar(36) NOT NULL,
	`token_hash` varchar(128) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`ip_address` varchar(45),
	`user_agent` varchar(512),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_sessions_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(160) NOT NULL,
	`role` enum('admin','retailer') NOT NULL DEFAULT 'retailer',
	`status` enum('active','inactive','suspended') NOT NULL DEFAULT 'active',
	`phone` varchar(32),
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`admin_user_id` varchar(36),
	`action` varchar(120) NOT NULL,
	`entity_type` varchar(80) NOT NULL,
	`entity_id` varchar(80),
	`ip_address` varchar(45),
	`user_agent` varchar(512),
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_usage_stats` (
	`id` varchar(36) NOT NULL,
	`venue_id` varchar(36),
	`package_id` varchar(36),
	`stat_date` date NOT NULL,
	`sessions_count` int NOT NULL DEFAULT 0,
	`active_users_count` int NOT NULL DEFAULT 0,
	`upload_bytes` bigint NOT NULL DEFAULT 0,
	`download_bytes` bigint NOT NULL DEFAULT 0,
	`revenue_tsh` decimal(14,2) NOT NULL DEFAULT '0.00',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_usage_stats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `package_policies` (
	`id` varchar(36) NOT NULL,
	`package_id` varchar(36) NOT NULL,
	`policy_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `package_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `package_policies_pair_unique` UNIQUE(`package_id`,`policy_id`)
);
--> statement-breakpoint
CREATE TABLE `packages` (
	`id` varchar(36) NOT NULL,
	`name` varchar(180) NOT NULL,
	`package_type` enum('hotspot','home','business','premium') NOT NULL DEFAULT 'hotspot',
	`description` text,
	`duration_hours` int NOT NULL,
	`download_speed_mbps` int NOT NULL,
	`upload_speed_mbps` int,
	`data_limit_gb` int,
	`device_limit` int NOT NULL DEFAULT 1,
	`price_tsh` decimal(12,2) NOT NULL,
	`features` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `packages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` varchar(36) NOT NULL,
	`customer_id` varchar(36),
	`voucher_id` varchar(36),
	`package_id` varchar(36),
	`venue_id` varchar(36),
	`provider` enum('cash','mpesa','card','manual') NOT NULL DEFAULT 'manual',
	`provider_reference` varchar(160),
	`phone` varchar(32),
	`amount_tsh` decimal(12,2) NOT NULL,
	`status` enum('pending','paid','failed','refunded','cancelled') NOT NULL DEFAULT 'pending',
	`paid_at` timestamp,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` varchar(36) NOT NULL,
	`name` varchar(180) NOT NULL,
	`description` text,
	`category` enum('network','user','security','billing','access') NOT NULL,
	`type` enum('restriction','privilege','rule','automation') NOT NULL,
	`priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`is_active` boolean NOT NULL DEFAULT true,
	`applies_to` json NOT NULL,
	`conditions` json NOT NULL,
	`actions` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `portal_settings` (
	`id` varchar(36) NOT NULL,
	`venue_id` varchar(36) NOT NULL,
	`brand_name` varchar(160) NOT NULL,
	`logo_text` varchar(8) NOT NULL DEFAULT 'W',
	`logo_url` varchar(512),
	`background_image_url` varchar(512),
	`headline` varchar(180) NOT NULL,
	`message` text NOT NULL,
	`primary_color` varchar(16) NOT NULL,
	`accent_color` varchar(16) NOT NULL,
	`background_color` varchar(16) NOT NULL,
	`background_style` enum('solid','soft','split') NOT NULL DEFAULT 'soft',
	`radius` int NOT NULL DEFAULT 18,
	`auth_mode` enum('voucher','phone','package') NOT NULL DEFAULT 'voucher',
	`voucher_label` varchar(100) NOT NULL,
	`voucher_prefix` varchar(24) NOT NULL DEFAULT 'WIFI',
	`voucher_help` text NOT NULL,
	`ticket_title` varchar(160) NOT NULL,
	`ticket_footer` varchar(255) NOT NULL,
	`show_packages` boolean NOT NULL DEFAULT true,
	`show_mpesa` boolean NOT NULL DEFAULT true,
	`require_phone` boolean NOT NULL DEFAULT true,
	`require_terms` boolean NOT NULL DEFAULT true,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portal_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `portal_settings_venue_id_unique` UNIQUE(`venue_id`)
);
--> statement-breakpoint
CREATE TABLE `routers` (
	`id` varchar(36) NOT NULL,
	`venue_id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`model` varchar(160),
	`identity` varchar(160),
	`ip_address` varchar(45) NOT NULL,
	`mac_address` varchar(32),
	`api_username` varchar(120),
	`api_password_encrypted` text,
	`enable_pppoe` boolean NOT NULL DEFAULT false,
	`enable_hotspot` boolean NOT NULL DEFAULT true,
	`pppoe_secret_encrypted` text,
	`hotspot_name` varchar(160),
	`hotspot_interface` varchar(80),
	`network_range` varchar(64),
	`provisioning_command` text,
	`provisioned_at` timestamp,
	`last_seen_at` timestamp,
	`uptime_seconds` bigint NOT NULL DEFAULT 0,
	`connected_devices` int NOT NULL DEFAULT 0,
	`status` enum('online','offline','provisioning','error') NOT NULL DEFAULT 'offline',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `routers_id` PRIMARY KEY(`id`),
	CONSTRAINT `routers_mac_address_unique` UNIQUE(`mac_address`)
);
--> statement-breakpoint
CREATE TABLE `session_usage_samples` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`sampled_at` timestamp NOT NULL DEFAULT (now()),
	`upload_bytes` bigint NOT NULL DEFAULT 0,
	`download_bytes` bigint NOT NULL DEFAULT 0,
	`upload_speed_mbps` decimal(8,2),
	`download_speed_mbps` decimal(8,2),
	`signal_strength_dbm` int,
	CONSTRAINT `session_usage_samples_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `venues` (
	`id` varchar(36) NOT NULL,
	`operator_id` varchar(36),
	`name` varchar(180) NOT NULL,
	`description` text,
	`address` varchar(255),
	`road` varchar(120),
	`street` varchar(120),
	`ward` varchar(120),
	`district` varchar(120),
	`city` varchar(120) NOT NULL,
	`region` varchar(120),
	`country` varchar(120) NOT NULL DEFAULT 'Tanzania',
	`postal_code` varchar(30),
	`contact_phone` varchar(32),
	`contact_email` varchar(255),
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`status` enum('active','inactive','maintenance') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `venues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `voucher_batches` (
	`id` varchar(36) NOT NULL,
	`package_id` varchar(36),
	`venue_id` varchar(36),
	`created_by_id` varchar(36),
	`quantity` int NOT NULL,
	`prefix` varchar(24) NOT NULL DEFAULT 'WIFI',
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voucher_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vouchers` (
	`id` varchar(36) NOT NULL,
	`batch_id` varchar(36),
	`package_id` varchar(36),
	`venue_id` varchar(36),
	`assigned_customer_id` varchar(36),
	`code` varchar(80) NOT NULL,
	`status` enum('unused','active','expired','revoked') NOT NULL DEFAULT 'unused',
	`data_limit_gb` int,
	`data_used_bytes` bigint NOT NULL DEFAULT 0,
	`duration_hours` int,
	`price_tsh` decimal(12,2) NOT NULL,
	`activated_at` timestamp,
	`expires_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vouchers_id` PRIMARY KEY(`id`),
	CONSTRAINT `vouchers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `wifi_customers` (
	`id` varchar(36) NOT NULL,
	`username` varchar(120),
	`email` varchar(255),
	`phone` varchar(32),
	`mac_address` varchar(32),
	`last_ip_address` varchar(45),
	`device_name` varchar(160),
	`device_type` varchar(40),
	`status` enum('active','inactive','blocked') NOT NULL DEFAULT 'active',
	`joined_at` timestamp NOT NULL DEFAULT (now()),
	`last_active_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wifi_customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `wifi_customers_mac_address_unique` UNIQUE(`mac_address`)
);
--> statement-breakpoint
CREATE TABLE `wifi_sessions` (
	`id` varchar(36) NOT NULL,
	`customer_id` varchar(36),
	`voucher_id` varchar(36),
	`package_id` varchar(36),
	`venue_id` varchar(36),
	`router_id` varchar(36),
	`mac_address` varchar(32) NOT NULL,
	`ip_address` varchar(45),
	`device_name` varchar(160),
	`device_type` varchar(40),
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`ended_at` timestamp,
	`duration_seconds` int NOT NULL DEFAULT 0,
	`upload_bytes` bigint NOT NULL DEFAULT 0,
	`download_bytes` bigint NOT NULL DEFAULT 0,
	`upload_speed_mbps` decimal(8,2),
	`download_speed_mbps` decimal(8,2),
	`signal_strength_dbm` int,
	`termination_reason` varchar(120),
	`status` enum('connected','disconnected','expired','terminated') NOT NULL DEFAULT 'connected',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wifi_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admin_otp_codes` ADD CONSTRAINT `admin_otp_codes_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_preferences` ADD CONSTRAINT `admin_preferences_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_usage_stats` ADD CONSTRAINT `daily_usage_stats_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_usage_stats` ADD CONSTRAINT `daily_usage_stats_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_policies` ADD CONSTRAINT `package_policies_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `package_policies` ADD CONSTRAINT `package_policies_policy_id_policies_id_fk` FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_customer_id_wifi_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `wifi_customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_voucher_id_vouchers_id_fk` FOREIGN KEY (`voucher_id`) REFERENCES `vouchers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `portal_settings` ADD CONSTRAINT `portal_settings_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routers` ADD CONSTRAINT `routers_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session_usage_samples` ADD CONSTRAINT `session_usage_samples_session_id_wifi_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `wifi_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `venues` ADD CONSTRAINT `venues_operator_id_admin_users_id_fk` FOREIGN KEY (`operator_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `voucher_batches` ADD CONSTRAINT `voucher_batches_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `voucher_batches` ADD CONSTRAINT `voucher_batches_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `voucher_batches` ADD CONSTRAINT `voucher_batches_created_by_id_admin_users_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vouchers` ADD CONSTRAINT `vouchers_batch_id_voucher_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `voucher_batches`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vouchers` ADD CONSTRAINT `vouchers_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vouchers` ADD CONSTRAINT `vouchers_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vouchers` ADD CONSTRAINT `vouchers_assigned_customer_id_wifi_customers_id_fk` FOREIGN KEY (`assigned_customer_id`) REFERENCES `wifi_customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wifi_sessions` ADD CONSTRAINT `wifi_sessions_customer_id_wifi_customers_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `wifi_customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wifi_sessions` ADD CONSTRAINT `wifi_sessions_voucher_id_vouchers_id_fk` FOREIGN KEY (`voucher_id`) REFERENCES `vouchers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wifi_sessions` ADD CONSTRAINT `wifi_sessions_package_id_packages_id_fk` FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wifi_sessions` ADD CONSTRAINT `wifi_sessions_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wifi_sessions` ADD CONSTRAINT `wifi_sessions_router_id_routers_id_fk` FOREIGN KEY (`router_id`) REFERENCES `routers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_otp_codes_admin_user_id_idx` ON `admin_otp_codes` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `admin_otp_codes_expires_at_idx` ON `admin_otp_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `admin_sessions_admin_user_id_idx` ON `admin_sessions` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_at_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `admin_users_role_idx` ON `admin_users` (`role`);--> statement-breakpoint
CREATE INDEX `audit_logs_admin_user_id_idx` ON `audit_logs` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `daily_usage_stats_venue_id_idx` ON `daily_usage_stats` (`venue_id`);--> statement-breakpoint
CREATE INDEX `daily_usage_stats_package_id_idx` ON `daily_usage_stats` (`package_id`);--> statement-breakpoint
CREATE INDEX `daily_usage_stats_date_idx` ON `daily_usage_stats` (`stat_date`);--> statement-breakpoint
CREATE INDEX `package_policies_package_id_idx` ON `package_policies` (`package_id`);--> statement-breakpoint
CREATE INDEX `package_policies_policy_id_idx` ON `package_policies` (`policy_id`);--> statement-breakpoint
CREATE INDEX `packages_type_idx` ON `packages` (`package_type`);--> statement-breakpoint
CREATE INDEX `packages_active_idx` ON `packages` (`is_active`);--> statement-breakpoint
CREATE INDEX `packages_price_idx` ON `packages` (`price_tsh`);--> statement-breakpoint
CREATE INDEX `payments_customer_id_idx` ON `payments` (`customer_id`);--> statement-breakpoint
CREATE INDEX `payments_voucher_id_idx` ON `payments` (`voucher_id`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `payments_provider_reference_idx` ON `payments` (`provider_reference`);--> statement-breakpoint
CREATE INDEX `policies_category_idx` ON `policies` (`category`);--> statement-breakpoint
CREATE INDEX `policies_active_idx` ON `policies` (`is_active`);--> statement-breakpoint
CREATE INDEX `policies_priority_idx` ON `policies` (`priority`);--> statement-breakpoint
CREATE INDEX `portal_settings_active_idx` ON `portal_settings` (`is_active`);--> statement-breakpoint
CREATE INDEX `routers_venue_id_idx` ON `routers` (`venue_id`);--> statement-breakpoint
CREATE INDEX `routers_status_idx` ON `routers` (`status`);--> statement-breakpoint
CREATE INDEX `routers_ip_address_idx` ON `routers` (`ip_address`);--> statement-breakpoint
CREATE INDEX `session_usage_samples_session_id_idx` ON `session_usage_samples` (`session_id`);--> statement-breakpoint
CREATE INDEX `session_usage_samples_sampled_at_idx` ON `session_usage_samples` (`sampled_at`);--> statement-breakpoint
CREATE INDEX `venues_operator_id_idx` ON `venues` (`operator_id`);--> statement-breakpoint
CREATE INDEX `venues_city_idx` ON `venues` (`city`);--> statement-breakpoint
CREATE INDEX `venues_status_idx` ON `venues` (`status`);--> statement-breakpoint
CREATE INDEX `voucher_batches_package_id_idx` ON `voucher_batches` (`package_id`);--> statement-breakpoint
CREATE INDEX `voucher_batches_venue_id_idx` ON `voucher_batches` (`venue_id`);--> statement-breakpoint
CREATE INDEX `voucher_batches_created_by_id_idx` ON `voucher_batches` (`created_by_id`);--> statement-breakpoint
CREATE INDEX `vouchers_status_idx` ON `vouchers` (`status`);--> statement-breakpoint
CREATE INDEX `vouchers_package_id_idx` ON `vouchers` (`package_id`);--> statement-breakpoint
CREATE INDEX `vouchers_venue_id_idx` ON `vouchers` (`venue_id`);--> statement-breakpoint
CREATE INDEX `vouchers_assigned_customer_id_idx` ON `vouchers` (`assigned_customer_id`);--> statement-breakpoint
CREATE INDEX `wifi_customers_phone_idx` ON `wifi_customers` (`phone`);--> statement-breakpoint
CREATE INDEX `wifi_customers_status_idx` ON `wifi_customers` (`status`);--> statement-breakpoint
CREATE INDEX `wifi_sessions_customer_id_idx` ON `wifi_sessions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `wifi_sessions_voucher_id_idx` ON `wifi_sessions` (`voucher_id`);--> statement-breakpoint
CREATE INDEX `wifi_sessions_router_id_idx` ON `wifi_sessions` (`router_id`);--> statement-breakpoint
CREATE INDEX `wifi_sessions_status_idx` ON `wifi_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `wifi_sessions_started_at_idx` ON `wifi_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `wifi_sessions_mac_address_idx` ON `wifi_sessions` (`mac_address`);
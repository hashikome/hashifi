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
  CONSTRAINT `audit_logs_pk` PRIMARY KEY (`id`),
  CONSTRAINT `audit_logs_admin_user_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_admin_user_id_idx` ON `audit_logs` (`admin_user_id`);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`, `entity_id`);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);

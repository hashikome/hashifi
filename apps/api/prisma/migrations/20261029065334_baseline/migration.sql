-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('admin', 'manager');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "venue_status" AS ENUM ('active', 'inactive', 'maintenance');

-- CreateEnum
CREATE TYPE "router_status" AS ENUM ('online', 'offline', 'provisioning', 'error');

-- CreateEnum
CREATE TYPE "package_type" AS ENUM ('hotspot', 'home', 'business', 'premium');

-- CreateEnum
CREATE TYPE "voucher_status" AS ENUM ('unused', 'pending_activation', 'active', 'expired', 'used', 'revoked');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('active', 'inactive', 'blocked');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('connected', 'disconnected', 'expired', 'terminated');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('cash', 'mobile_money', 'card', 'manual');

-- CreateEnum
CREATE TYPE "portal_background_style" AS ENUM ('solid', 'soft', 'split');

-- CreateEnum
CREATE TYPE "theme_preference" AS ENUM ('light', 'dark', 'system');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'manager',
    "status" "account_status" NOT NULL DEFAULT 'active',
    "phone" VARCHAR(32),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_preferences" (
    "admin_user_id" UUID NOT NULL,
    "theme" "theme_preference" NOT NULL DEFAULT 'system',
    "email_notifications" BOOLEAN NOT NULL DEFAULT true,
    "push_notifications" BOOLEAN NOT NULL DEFAULT true,
    "session_alerts" BOOLEAN NOT NULL DEFAULT true,
    "security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_preferences_pkey" PRIMARY KEY ("admin_user_id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operator_id" UUID,
    "name" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "address" VARCHAR(255),
    "road" VARCHAR(120),
    "street" VARCHAR(120),
    "ward" VARCHAR(120),
    "district" VARCHAR(120),
    "city" VARCHAR(120) NOT NULL,
    "region" VARCHAR(120),
    "country" VARCHAR(120) NOT NULL DEFAULT 'Tanzania',
    "postal_code" VARCHAR(30),
    "contact_phone" VARCHAR(32),
    "contact_email" VARCHAR(255),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "status" "venue_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "venue_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "model" VARCHAR(160),
    "identity" VARCHAR(160),
    "ip_address" VARCHAR(45) NOT NULL,
    "hotspot_gateway_ip" VARCHAR(45),
    "mac_address" VARCHAR(32),
    "api_username" VARCHAR(120),
    "api_password_encrypted" TEXT,
    "enable_hotspot" BOOLEAN NOT NULL DEFAULT true,
    "hotspot_name" VARCHAR(160),
    "hotspot_interface" VARCHAR(80),
    "ssid" VARCHAR(32),
    "network_range" VARCHAR(64),
    "provisioning_command" TEXT,
    "provisioned_at" TIMESTAMPTZ(3),
    "tunnel_address" VARCHAR(45),
    "tunnel_public_key" VARCHAR(64),
    "tunnel_private_key_encrypted" TEXT,
    "ros_version" VARCHAR(32),
    "architecture" VARCHAR(32),
    "capabilities" JSONB,
    "last_provision_report" JSONB,
    "last_seen_at" TIMESTAMPTZ(3),
    "uptime_seconds" INTEGER NOT NULL DEFAULT 0,
    "connected_devices" INTEGER NOT NULL DEFAULT 0,
    "status" "router_status" NOT NULL DEFAULT 'offline',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "routers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(180) NOT NULL,
    "package_type" "package_type" NOT NULL DEFAULT 'hotspot',
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "download_speed_mbps" INTEGER NOT NULL,
    "upload_speed_mbps" INTEGER,
    "data_limit_gb" INTEGER,
    "device_limit" INTEGER NOT NULL DEFAULT 1,
    "price_tsh" DECIMAL(12,2) NOT NULL,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "throttled_download_mbps" INTEGER,
    "throttled_upload_mbps" INTEGER,
    "peak_start_hour" INTEGER,
    "peak_end_hour" INTEGER,
    "throttle_after_gb" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_packages" (
    "venue_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_packages_pkey" PRIMARY KEY ("venue_id","package_id")
);

-- CreateTable
CREATE TABLE "wifi_customers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "username" VARCHAR(120),
    "email" VARCHAR(255),
    "phone" VARCHAR(32),
    "mac_address" VARCHAR(32),
    "last_ip_address" VARCHAR(45),
    "device_name" VARCHAR(160),
    "device_type" VARCHAR(40),
    "status" "customer_status" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wifi_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_batches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "package_id" UUID,
    "venue_id" UUID,
    "created_by_id" UUID,
    "quantity" INTEGER NOT NULL,
    "prefix" VARCHAR(24) NOT NULL DEFAULT 'WIFI',
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voucher_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "batch_id" UUID,
    "package_id" UUID,
    "venue_id" UUID,
    "assigned_customer_id" UUID,
    "code" VARCHAR(80) NOT NULL,
    "status" "voucher_status" NOT NULL DEFAULT 'unused',
    "data_limit_gb" INTEGER,
    "data_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "duration_minutes" INTEGER,
    "price_tsh" DECIMAL(12,2) NOT NULL,
    "activated_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "customer_id" UUID,
    "voucher_id" UUID,
    "package_id" UUID,
    "venue_id" UUID,
    "provider" "payment_provider" NOT NULL DEFAULT 'manual',
    "provider_reference" VARCHAR(160),
    "phone" VARCHAR(32),
    "amount_tsh" DECIMAL(12,2) NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(3),
    "router_provisioned_at" TIMESTAMPTZ(3),
    "provision_error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wifi_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "customer_id" UUID,
    "voucher_id" UUID,
    "package_id" UUID,
    "venue_id" UUID,
    "router_id" UUID,
    "mac_address" VARCHAR(32) NOT NULL,
    "ip_address" VARCHAR(45),
    "device_name" VARCHAR(160),
    "device_type" VARCHAR(40),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "upload_bytes" BIGINT NOT NULL DEFAULT 0,
    "download_bytes" BIGINT NOT NULL DEFAULT 0,
    "upload_speed_mbps" DECIMAL(8,2),
    "download_speed_mbps" DECIMAL(8,2),
    "signal_strength_dbm" INTEGER,
    "termination_reason" VARCHAR(120),
    "is_throttled" BOOLEAN NOT NULL DEFAULT false,
    "status" "session_status" NOT NULL DEFAULT 'connected',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wifi_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_usage_samples" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID NOT NULL,
    "sampled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upload_bytes" BIGINT NOT NULL DEFAULT 0,
    "download_bytes" BIGINT NOT NULL DEFAULT 0,
    "upload_speed_mbps" DECIMAL(8,2),
    "download_speed_mbps" DECIMAL(8,2),
    "signal_strength_dbm" INTEGER,

    CONSTRAINT "session_usage_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "brand_name" VARCHAR(160) NOT NULL,
    "logo_text" VARCHAR(8) NOT NULL DEFAULT 'H',
    "logo_url" VARCHAR(512),
    "background_image_url" VARCHAR(512),
    "headline" VARCHAR(180) NOT NULL,
    "message" TEXT NOT NULL,
    "primary_color" VARCHAR(16) NOT NULL,
    "accent_color" VARCHAR(16) NOT NULL,
    "background_color" VARCHAR(16) NOT NULL,
    "background_style" "portal_background_style" NOT NULL DEFAULT 'soft',
    "radius" INTEGER NOT NULL DEFAULT 18,
    "voucher_label" VARCHAR(100) NOT NULL,
    "voucher_prefix" VARCHAR(24) NOT NULL DEFAULT 'WIFI',
    "voucher_help" TEXT NOT NULL,
    "ticket_title" VARCHAR(160) NOT NULL,
    "ticket_footer" VARCHAR(255) NOT NULL,
    "require_terms" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portal_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_usage_stats" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "venue_id" UUID,
    "package_id" UUID,
    "stat_date" DATE NOT NULL,
    "sessions_count" INTEGER NOT NULL DEFAULT 0,
    "active_users_count" INTEGER NOT NULL DEFAULT 0,
    "upload_bytes" BIGINT NOT NULL DEFAULT 0,
    "download_bytes" BIGINT NOT NULL DEFAULT 0,
    "revenue_tsh" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_usage_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "admin_user_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(80),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_role_idx" ON "admin_users"("role");

-- CreateIndex
CREATE INDEX "venues_operator_id_idx" ON "venues"("operator_id");

-- CreateIndex
CREATE INDEX "venues_city_idx" ON "venues"("city");

-- CreateIndex
CREATE INDEX "venues_status_idx" ON "venues"("status");

-- CreateIndex
CREATE UNIQUE INDEX "routers_mac_address_key" ON "routers"("mac_address");

-- CreateIndex
CREATE UNIQUE INDEX "routers_tunnel_address_key" ON "routers"("tunnel_address");

-- CreateIndex
CREATE UNIQUE INDEX "routers_tunnel_public_key_key" ON "routers"("tunnel_public_key");

-- CreateIndex
CREATE INDEX "routers_venue_id_idx" ON "routers"("venue_id");

-- CreateIndex
CREATE INDEX "routers_status_idx" ON "routers"("status");

-- CreateIndex
CREATE INDEX "routers_ip_address_idx" ON "routers"("ip_address");

-- CreateIndex
CREATE INDEX "packages_package_type_idx" ON "packages"("package_type");

-- CreateIndex
CREATE INDEX "packages_is_active_idx" ON "packages"("is_active");

-- CreateIndex
CREATE INDEX "packages_price_tsh_idx" ON "packages"("price_tsh");

-- CreateIndex
CREATE INDEX "venue_packages_package_id_idx" ON "venue_packages"("package_id");

-- CreateIndex
CREATE UNIQUE INDEX "wifi_customers_mac_address_key" ON "wifi_customers"("mac_address");

-- CreateIndex
CREATE INDEX "wifi_customers_phone_idx" ON "wifi_customers"("phone");

-- CreateIndex
CREATE INDEX "wifi_customers_status_idx" ON "wifi_customers"("status");

-- CreateIndex
CREATE INDEX "voucher_batches_package_id_idx" ON "voucher_batches"("package_id");

-- CreateIndex
CREATE INDEX "voucher_batches_venue_id_idx" ON "voucher_batches"("venue_id");

-- CreateIndex
CREATE INDEX "voucher_batches_created_by_id_idx" ON "voucher_batches"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");

-- CreateIndex
CREATE INDEX "vouchers_status_idx" ON "vouchers"("status");

-- CreateIndex
CREATE INDEX "vouchers_package_id_idx" ON "vouchers"("package_id");

-- CreateIndex
CREATE INDEX "vouchers_venue_id_idx" ON "vouchers"("venue_id");

-- CreateIndex
CREATE INDEX "vouchers_assigned_customer_id_idx" ON "vouchers"("assigned_customer_id");

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- CreateIndex
CREATE INDEX "payments_voucher_id_idx" ON "payments"("voucher_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_provider_reference_idx" ON "payments"("provider_reference");

-- CreateIndex
CREATE INDEX "wifi_sessions_customer_id_idx" ON "wifi_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "wifi_sessions_voucher_id_idx" ON "wifi_sessions"("voucher_id");

-- CreateIndex
CREATE INDEX "wifi_sessions_router_id_idx" ON "wifi_sessions"("router_id");

-- CreateIndex
CREATE INDEX "wifi_sessions_status_idx" ON "wifi_sessions"("status");

-- CreateIndex
CREATE INDEX "wifi_sessions_started_at_idx" ON "wifi_sessions"("started_at");

-- CreateIndex
CREATE INDEX "wifi_sessions_mac_address_idx" ON "wifi_sessions"("mac_address");

-- CreateIndex
CREATE INDEX "session_usage_samples_session_id_idx" ON "session_usage_samples"("session_id");

-- CreateIndex
CREATE INDEX "session_usage_samples_sampled_at_idx" ON "session_usage_samples"("sampled_at");

-- CreateIndex
CREATE INDEX "portal_settings_is_active_idx" ON "portal_settings"("is_active");

-- CreateIndex
CREATE INDEX "daily_usage_stats_venue_id_idx" ON "daily_usage_stats"("venue_id");

-- CreateIndex
CREATE INDEX "daily_usage_stats_package_id_idx" ON "daily_usage_stats"("package_id");

-- CreateIndex
CREATE INDEX "daily_usage_stats_stat_date_idx" ON "daily_usage_stats"("stat_date");

-- CreateIndex
CREATE INDEX "audit_logs_admin_user_id_idx" ON "audit_logs"("admin_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "admin_preferences" ADD CONSTRAINT "admin_preferences_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routers" ADD CONSTRAINT "routers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_packages" ADD CONSTRAINT "venue_packages_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_packages" ADD CONSTRAINT "venue_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "voucher_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_assigned_customer_id_fkey" FOREIGN KEY ("assigned_customer_id") REFERENCES "wifi_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "wifi_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "wifi_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wifi_sessions" ADD CONSTRAINT "wifi_sessions_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_usage_samples" ADD CONSTRAINT "session_usage_samples_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "wifi_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage_stats" ADD CONSTRAINT "daily_usage_stats_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_usage_stats" ADD CONSTRAINT "daily_usage_stats_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Constraints Prisma cannot express. RouterOS compares hotspot usernames case-sensitively
-- (measured in the router sim), so voucher codes and the prefixes they are built from are
-- upper-case, and guest input is upper-cased before lookup and login. Emails are lower-case so
-- that uniqueness and lookups ignore case. Normalise on write; these reject anything else.
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_code_upper" CHECK ("code" = upper("code"));
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_prefix_upper" CHECK ("prefix" = upper("prefix"));
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_voucher_prefix_upper" CHECK ("voucher_prefix" = upper("voucher_prefix"));
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_email_lower" CHECK ("email" = lower("email"));

-- Ranges the application assumes.
ALTER TABLE "packages" ADD CONSTRAINT "packages_peak_hours_range" CHECK (("peak_start_hour" IS NULL OR "peak_start_hour" BETWEEN 0 AND 23) AND ("peak_end_hour" IS NULL OR "peak_end_hour" BETWEEN 0 AND 23));
ALTER TABLE "packages" ADD CONSTRAINT "packages_positive" CHECK ("duration_minutes" > 0 AND "download_speed_mbps" > 0 AND "device_limit" > 0 AND "price_tsh" >= 0);

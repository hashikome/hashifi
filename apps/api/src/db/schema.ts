import { randomUUID } from "node:crypto";
import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const id = (name = "id") => varchar(name, { length: 36 });
const primaryId = (name = "id") => id(name).$defaultFn(() => randomUUID());

const timestamps = () => ({
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

const adminRole = (name = "role") => mysqlEnum(name, ["admin", "manager"]);
const accountStatus = (name = "status") => mysqlEnum(name, ["active", "inactive", "suspended"]);
const venueStatus = (name = "status") => mysqlEnum(name, ["active", "inactive", "maintenance"]);
const routerStatus = (name = "status") =>
  mysqlEnum(name, ["online", "offline", "provisioning", "error"]);
const packageType = (name = "package_type") =>
  mysqlEnum(name, ["hotspot", "home", "business", "premium"]);
// `pending_activation` = redeemed, but the router has not confirmed the hotspot user yet.
// Nothing should treat it as usable until the router read-back succeeds.
const voucherStatus = (name = "status") =>
  mysqlEnum(name, ["unused", "pending_activation", "active", "expired", "used", "revoked"]);
const customerStatus = (name = "status") => mysqlEnum(name, ["active", "inactive", "blocked"]);
const sessionStatus = (name = "status") =>
  mysqlEnum(name, ["connected", "disconnected", "expired", "terminated"]);
const paymentStatus = (name = "status") =>
  mysqlEnum(name, ["pending", "paid", "failed", "refunded", "cancelled"]);
const paymentProvider = (name = "provider") => mysqlEnum(name, ["cash", "mpesa", "card", "manual"]);
const portalBackgroundStyle = (name = "background_style") =>
  mysqlEnum(name, ["solid", "soft", "split"]);
const themePreference = (name = "theme") => mysqlEnum(name, ["light", "dark", "system"]);

export const adminUsers = mysqlTable(
  "admin_users",
  {
    id: primaryId().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    role: adminRole().notNull().default("manager"),
    status: accountStatus().notNull().default("active"),
    phone: varchar("phone", { length: 32 }),
    lastLoginAt: timestamp("last_login_at"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("admin_users_email_unique").on(table.email),
    index("admin_users_role_idx").on(table.role),
  ],
);

export const adminOtpCodes = mysqlTable(
  "admin_otp_codes",
  {
    id: primaryId().primaryKey(),
    adminUserId: id("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    codeHash: varchar("code_hash", { length: 255 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    attempts: int("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("admin_otp_codes_admin_user_id_idx").on(table.adminUserId),
    index("admin_otp_codes_expires_at_idx").on(table.expiresAt),
  ],
);

export const adminSessions = mysqlTable(
  "admin_sessions",
  {
    id: primaryId().primaryKey(),
    adminUserId: id("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_hash_unique").on(table.tokenHash),
    index("admin_sessions_admin_user_id_idx").on(table.adminUserId),
    index("admin_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const adminPreferences = mysqlTable(
  "admin_preferences",
  {
    id: primaryId().primaryKey(),
    adminUserId: id("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    theme: themePreference().notNull().default("system"),
    emailNotifications: boolean("email_notifications").notNull().default(true),
    pushNotifications: boolean("push_notifications").notNull().default(true),
    sessionAlerts: boolean("session_alerts").notNull().default(true),
    securityAlerts: boolean("security_alerts").notNull().default(true),
    ...timestamps(),
  },
  (table) => [uniqueIndex("admin_preferences_admin_user_id_unique").on(table.adminUserId)],
);

export const venues = mysqlTable(
  "venues",
  {
    id: primaryId().primaryKey(),
    operatorId: id("operator_id").references(() => adminUsers.id, { onDelete: "set null" }),
    name: varchar("name", { length: 180 }).notNull(),
    description: text("description"),
    address: varchar("address", { length: 255 }),
    road: varchar("road", { length: 120 }),
    street: varchar("street", { length: 120 }),
    ward: varchar("ward", { length: 120 }),
    district: varchar("district", { length: 120 }),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 120 }),
    country: varchar("country", { length: 120 }).notNull().default("Tanzania"),
    postalCode: varchar("postal_code", { length: 30 }),
    contactPhone: varchar("contact_phone", { length: 32 }),
    contactEmail: varchar("contact_email", { length: 255 }),
    latitude: decimal("latitude", { precision: 10, scale: 7 }),
    longitude: decimal("longitude", { precision: 10, scale: 7 }),
    status: venueStatus().notNull().default("active"),
    ...timestamps(),
  },
  (table) => [
    index("venues_operator_id_idx").on(table.operatorId),
    index("venues_city_idx").on(table.city),
    index("venues_status_idx").on(table.status),
  ],
);

export const routers = mysqlTable(
  "routers",
  {
    id: primaryId().primaryKey(),
    venueId: id("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    model: varchar("model", { length: 160 }),
    identity: varchar("identity", { length: 160 }),
    ipAddress: varchar("ip_address", { length: 45 }).notNull(),
    hotspotGatewayIp: varchar("hotspot_gateway_ip", { length: 45 }),
    macAddress: varchar("mac_address", { length: 32 }),
    apiUsername: varchar("api_username", { length: 120 }),
    apiPasswordEncrypted: text("api_password_encrypted"),
    enablePppoe: boolean("enable_pppoe").notNull().default(false),
    enableHotspot: boolean("enable_hotspot").notNull().default(true),
    pppoeSecretEncrypted: text("pppoe_secret_encrypted"),
    hotspotName: varchar("hotspot_name", { length: 160 }),
    hotspotInterface: varchar("hotspot_interface", { length: 80 }),
    /** Network name customers see. Null = leave whatever the radio is already broadcasting. */
    ssid: varchar("ssid", { length: 32 }),
    networkRange: varchar("network_range", { length: 64 }),
    provisioningCommand: text("provisioning_command"),
    provisionedAt: timestamp("provisioned_at"),
    // Cached capability probe — see services/router-provision/probe.ts
    rosVersion: varchar("ros_version", { length: 32 }),
    architecture: varchar("architecture", { length: 32 }),
    capabilities: json("capabilities"),
    lastProvisionReport: json("last_provision_report"),
    lastSeenAt: timestamp("last_seen_at"),
    uptimeSeconds: bigint("uptime_seconds", { mode: "number" }).notNull().default(0),
    connectedDevices: int("connected_devices").notNull().default(0),
    status: routerStatus().notNull().default("offline"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("routers_mac_address_unique").on(table.macAddress),
    index("routers_venue_id_idx").on(table.venueId),
    index("routers_status_idx").on(table.status),
    index("routers_ip_address_idx").on(table.ipAddress),
  ],
);

export const packages = mysqlTable(
  "packages",
  {
    id: primaryId().primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    packageType: packageType().notNull().default("hotspot"),
    description: text("description"),
    /** Whole minutes. Was hours until 0014 — see utils/duration.ts. */
    durationMinutes: int("duration_minutes").notNull(),
    downloadSpeedMbps: int("download_speed_mbps").notNull(),
    uploadSpeedMbps: int("upload_speed_mbps"),
    dataLimitGb: int("data_limit_gb"),
    deviceLimit: int("device_limit").notNull().default(1),
    priceTsh: decimal("price_tsh", { precision: 12, scale: 2 }).notNull(),
    features: json("features").$type<string[]>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    throttledDownloadMbps: int("throttled_download_mbps"),
    throttledUploadMbps: int("throttled_upload_mbps"),
    peakStartHour: int("peak_start_hour"),
    peakEndHour: int("peak_end_hour"),
    throttleAfterGb: int("throttle_after_gb"),
    ...timestamps(),
  },
  (table) => [
    index("packages_type_idx").on(table.packageType),
    index("packages_active_idx").on(table.isActive),
    index("packages_price_idx").on(table.priceTsh),
  ],
);

export const wifiCustomers = mysqlTable(
  "wifi_customers",
  {
    id: primaryId().primaryKey(),
    username: varchar("username", { length: 120 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 32 }),
    macAddress: varchar("mac_address", { length: 32 }),
    lastIpAddress: varchar("last_ip_address", { length: 45 }),
    deviceName: varchar("device_name", { length: 160 }),
    deviceType: varchar("device_type", { length: 40 }),
    status: customerStatus().notNull().default("active"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("wifi_customers_mac_address_unique").on(table.macAddress),
    index("wifi_customers_phone_idx").on(table.phone),
    index("wifi_customers_status_idx").on(table.status),
  ],
);
export const voucherBatches = mysqlTable(
  "voucher_batches",
  {
    id: primaryId().primaryKey(),
    packageId: id("package_id").references(() => packages.id, { onDelete: "set null" }),
    venueId: id("venue_id").references(() => venues.id, { onDelete: "set null" }),
    createdById: id("created_by_id").references(() => adminUsers.id, { onDelete: "set null" }),
    quantity: int("quantity").notNull(),
    prefix: varchar("prefix", { length: 24 }).notNull().default("WIFI"),
    expiresAt: timestamp("expires_at"),
    ...timestamps(),
  },
  (table) => [
    index("voucher_batches_package_id_idx").on(table.packageId),
    index("voucher_batches_venue_id_idx").on(table.venueId),
    index("voucher_batches_created_by_id_idx").on(table.createdById),
  ],
);

export const vouchers = mysqlTable(
  "vouchers",
  {
    id: primaryId().primaryKey(),
    batchId: id("batch_id").references(() => voucherBatches.id, { onDelete: "set null" }),
    packageId: id("package_id").references(() => packages.id, { onDelete: "set null" }),
    venueId: id("venue_id").references(() => venues.id, { onDelete: "set null" }),
    assignedCustomerId: id("assigned_customer_id").references(() => wifiCustomers.id, {
      onDelete: "set null",
    }),
    code: varchar("code", { length: 80 }).notNull(),
    status: voucherStatus().notNull().default("unused"),
    dataLimitGb: int("data_limit_gb"),
    dataUsedBytes: bigint("data_used_bytes", { mode: "number" }).notNull().default(0),
    /** Whole minutes; null inherits the package's. See utils/duration.ts. */
    durationMinutes: int("duration_minutes"),
    priceTsh: decimal("price_tsh", { precision: 12, scale: 2 }).notNull(),
    activatedAt: timestamp("activated_at"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("vouchers_code_unique").on(table.code),
    index("vouchers_status_idx").on(table.status),
    index("vouchers_package_id_idx").on(table.packageId),
    index("vouchers_venue_id_idx").on(table.venueId),
    index("vouchers_assigned_customer_id_idx").on(table.assignedCustomerId),
  ],
);

export const payments = mysqlTable(
  "payments",
  {
    id: primaryId().primaryKey(),
    customerId: id("customer_id").references(() => wifiCustomers.id, { onDelete: "set null" }),
    voucherId: id("voucher_id").references(() => vouchers.id, { onDelete: "set null" }),
    packageId: id("package_id").references(() => packages.id, { onDelete: "set null" }),
    venueId: id("venue_id").references(() => venues.id, { onDelete: "set null" }),
    provider: paymentProvider().notNull().default("manual"),
    providerReference: varchar("provider_reference", { length: 160 }),
    phone: varchar("phone", { length: 32 }),
    amountTsh: decimal("amount_tsh", { precision: 12, scale: 2 }).notNull(),
    status: paymentStatus().notNull().default("pending"),
    paidAt: timestamp("paid_at"),
    // Router provisioning is tracked separately from payment status: money can be
    // captured while the hotspot user still doesn't exist. The portal must wait on this,
    // not on `status === "paid"`.
    routerProvisionedAt: timestamp("router_provisioned_at"),
    provisionError: text("provision_error"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (table) => [
    index("payments_customer_id_idx").on(table.customerId),
    index("payments_voucher_id_idx").on(table.voucherId),
    index("payments_status_idx").on(table.status),
    index("payments_provider_reference_idx").on(table.providerReference),
  ],
);

export const wifiSessions = mysqlTable(
  "wifi_sessions",
  {
    id: primaryId().primaryKey(),
    customerId: id("customer_id").references(() => wifiCustomers.id, { onDelete: "set null" }),
    voucherId: id("voucher_id").references(() => vouchers.id, { onDelete: "set null" }),
    packageId: id("package_id").references(() => packages.id, { onDelete: "set null" }),
    venueId: id("venue_id").references(() => venues.id, { onDelete: "set null" }),
    routerId: id("router_id").references(() => routers.id, { onDelete: "set null" }),
    macAddress: varchar("mac_address", { length: 32 }).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    deviceName: varchar("device_name", { length: 160 }),
    deviceType: varchar("device_type", { length: 40 }),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
    durationSeconds: int("duration_seconds").notNull().default(0),
    uploadBytes: bigint("upload_bytes", { mode: "number" }).notNull().default(0),
    downloadBytes: bigint("download_bytes", { mode: "number" }).notNull().default(0),
    uploadSpeedMbps: decimal("upload_speed_mbps", { precision: 8, scale: 2 }),
    downloadSpeedMbps: decimal("download_speed_mbps", { precision: 8, scale: 2 }),
    signalStrengthDbm: int("signal_strength_dbm"),
    terminationReason: varchar("termination_reason", { length: 120 }),
    isThrottled: boolean("is_throttled").notNull().default(false),
    status: sessionStatus().notNull().default("connected"),
    ...timestamps(),
  },
  (table) => [
    index("wifi_sessions_customer_id_idx").on(table.customerId),
    index("wifi_sessions_voucher_id_idx").on(table.voucherId),
    index("wifi_sessions_router_id_idx").on(table.routerId),
    index("wifi_sessions_status_idx").on(table.status),
    index("wifi_sessions_started_at_idx").on(table.startedAt),
    index("wifi_sessions_mac_address_idx").on(table.macAddress),
  ],
);

export const sessionUsageSamples = mysqlTable(
  "session_usage_samples",
  {
    id: primaryId().primaryKey(),
    sessionId: id("session_id")
      .notNull()
      .references(() => wifiSessions.id, { onDelete: "cascade" }),
    sampledAt: timestamp("sampled_at").notNull().defaultNow(),
    uploadBytes: bigint("upload_bytes", { mode: "number" }).notNull().default(0),
    downloadBytes: bigint("download_bytes", { mode: "number" }).notNull().default(0),
    uploadSpeedMbps: decimal("upload_speed_mbps", { precision: 8, scale: 2 }),
    downloadSpeedMbps: decimal("download_speed_mbps", { precision: 8, scale: 2 }),
    signalStrengthDbm: int("signal_strength_dbm"),
  },
  (table) => [
    index("session_usage_samples_session_id_idx").on(table.sessionId),
    index("session_usage_samples_sampled_at_idx").on(table.sampledAt),
  ],
);

export const portalSettings = mysqlTable(
  "portal_settings",
  {
    id: primaryId().primaryKey(),
    brandName: varchar("brand_name", { length: 160 }).notNull(),
    logoText: varchar("logo_text", { length: 8 }).notNull().default("W"),
    logoUrl: varchar("logo_url", { length: 512 }),
    backgroundImageUrl: varchar("background_image_url", { length: 512 }),
    headline: varchar("headline", { length: 180 }).notNull(),
    message: text("message").notNull(),
    primaryColor: varchar("primary_color", { length: 16 }).notNull(),
    accentColor: varchar("accent_color", { length: 16 }).notNull(),
    backgroundColor: varchar("background_color", { length: 16 }).notNull(),
    backgroundStyle: portalBackgroundStyle().notNull().default("soft"),
    radius: int("radius").notNull().default(18),
    voucherLabel: varchar("voucher_label", { length: 100 }).notNull(),
    voucherPrefix: varchar("voucher_prefix", { length: 24 }).notNull().default("WIFI"),
    voucherHelp: text("voucher_help").notNull(),
    ticketTitle: varchar("ticket_title", { length: 160 }).notNull(),
    ticketFooter: varchar("ticket_footer", { length: 255 }).notNull(),
    requireTerms: boolean("require_terms").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (table) => [index("portal_settings_active_idx").on(table.isActive)],
);

export const dailyUsageStats = mysqlTable(
  "daily_usage_stats",
  {
    id: primaryId().primaryKey(),
    venueId: id("venue_id").references(() => venues.id, { onDelete: "set null" }),
    packageId: id("package_id").references(() => packages.id, { onDelete: "set null" }),
    statDate: date("stat_date").notNull(),
    sessionsCount: int("sessions_count").notNull().default(0),
    activeUsersCount: int("active_users_count").notNull().default(0),
    uploadBytes: bigint("upload_bytes", { mode: "number" }).notNull().default(0),
    downloadBytes: bigint("download_bytes", { mode: "number" }).notNull().default(0),
    revenueTsh: decimal("revenue_tsh", { precision: 14, scale: 2 }).notNull().default("0.00"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("daily_usage_stats_venue_id_idx").on(table.venueId),
    index("daily_usage_stats_package_id_idx").on(table.packageId),
    index("daily_usage_stats_date_idx").on(table.statDate),
  ],
);

export const venuePackages = mysqlTable(
  "venue_packages",
  {
    id: primaryId().primaryKey(),
    venueId: id("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    packageId: id("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("venue_packages_pair_unique").on(table.venueId, table.packageId),
    index("venue_packages_venue_id_idx").on(table.venueId),
    index("venue_packages_package_id_idx").on(table.packageId),
  ],
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: primaryId().primaryKey(),
    adminUserId: id("admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: varchar("entity_id", { length: 80 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 512 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_admin_user_id_idx").on(table.adminUserId),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

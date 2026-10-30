// The API's JSON contract, shared by the API and its clients. Framework-free: no runtime
// code, no Prisma or ORM types. JSON carries decimals as strings, timestamps as ISO 8601
// strings, and an absent value as `null`, never `undefined`.

/** ISO 8601 timestamp in UTC. */
export type Timestamp = string;
/** Decimal amount in whole or fractional TSH, serialised as a string. */
export type DecimalString = string;

// `pending_activation`: redeemed, but the router has not yet confirmed the hotspot user.
// Nothing treats it as usable until the router read-back succeeds.
export type VoucherStatus =
  | "unused"
  | "pending_activation"
  | "active"
  | "expired"
  | "used"
  | "revoked";

export type PackageType = "hotspot" | "home" | "business" | "premium";

export type PortalBackgroundStyle = "solid" | "soft" | "split";

export interface PackageRecord {
  id: string;
  name: string;
  packageType: PackageType;
  description: string | null;
  durationMinutes: number;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number | null;
  dataLimitGb: number | null;
  deviceLimit: number;
  priceTsh: DecimalString;
  features: string[];
  isActive: boolean;
  throttledDownloadMbps: number | null;
  throttledUploadMbps: number | null;
  peakStartHour: number | null;
  peakEndHour: number | null;
  throttleAfterGb: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface VoucherRecord {
  id: string;
  batchId: string | null;
  packageId: string | null;
  venueId: string | null;
  /** The device that redeemed it. */
  redeemedByDeviceId: string | null;
  code: string;
  status: VoucherStatus;
  dataLimitGb: number | null;
  dataUsedBytes: number;
  /** Whole minutes; null inherits the package's. */
  durationMinutes: number | null;
  priceTsh: DecimalString;
  activatedAt: Timestamp | null;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `GET /api/vouchers` row. */
export interface VoucherListItem extends VoucherRecord {
  packageName: string | null;
  venueName: string | null;
}

/** `GET /api/vouchers/by-codes` row, for printing. */
export interface PrintableVoucher extends VoucherListItem {
  downloadSpeed: number | null;
  uploadSpeed: number | null;
  /** The package's duration in whole minutes. */
  duration: number | null;
}

export interface PortalSettingsRecord {
  id: string;
  brandName: string;
  logoText: string;
  logoUrl: string | null;
  backgroundImageUrl: string | null;
  headline: string;
  message: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  backgroundStyle: PortalBackgroundStyle;
  radius: number;
  voucherLabel: string;
  voucherPrefix: string;
  voucherHelp: string;
  ticketTitle: string;
  ticketFooter: string;
  requireTerms: boolean;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PackagesResponse {
  packages: PackageRecord[];
}

export interface VouchersResponse {
  vouchers: VoucherListItem[];
}

export interface PrintableVouchersResponse {
  vouchers: PrintableVoucher[];
}

export interface PortalSettingsResponse {
  settings: PortalSettingsRecord;
}

/** Every API error body. */
export interface ApiErrorBody {
  error: string;
}

export type StaffRole = "admin" | "manager";

/** The signed-in staff member (`GET /api/me`). */
export interface SignedInStaff {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  twoFactorEnabled: boolean;
  /**
   * True while an admin has no authenticator app: every other route answers 403
   * `TWO_FACTOR_ENROLLMENT_REQUIRED` until one is set up.
   */
  twoFactorEnrollmentRequired: boolean;
}

/** Every error the API answers with (Better Auth's `/api/auth` routes keep their own shape). */
export interface ApiError {
  /** Stable and machine-readable, such as `VALIDATION_FAILED` or `NOT_FOUND`. */
  code: string;
  message: string;
  /** Field problems for `VALIDATION_FAILED`, keyed by field path; otherwise null. */
  details: Record<string, string> | null;
}

export type VenueStatus = "active" | "inactive" | "maintenance";

export interface VenueRecord {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  road: string | null;
  street: string | null;
  ward: string | null;
  district: string | null;
  city: string;
  region: string | null;
  country: string;
  postalCode: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  /** Decimal degrees, as strings. */
  latitude: DecimalString | null;
  longitude: DecimalString | null;
  /** The manager who runs it. */
  operatorId: string | null;
  status: VenueStatus;
  routerCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `GET /api/venues`. */
export interface VenueList {
  venues: VenueRecord[];
}

/** `GET` and `PUT /api/venues/:id`, and `POST /api/venues`. */
export interface VenueResponse {
  venue: VenueRecord;
}

export type RouterStatus = "online" | "offline" | "provisioning" | "error";

/** A router as the API shows it. Credentials and tunnel keys never leave the API. */
export interface RouterRecord {
  id: string;
  venueId: string;
  venueName: string;
  name: string;
  model: string | null;
  identity: string | null;
  /** The router's address on its venue LAN. */
  ipAddress: string;
  hotspotGatewayIp: string | null;
  macAddress: string | null;
  apiUsername: string | null;
  /** Whether an API password is stored; the password itself is never returned. */
  hasApiPassword: boolean;
  enableHotspot: boolean;
  hotspotName: string | null;
  hotspotInterface: string | null;
  ssid: string | null;
  networkRange: string | null;
  /**
   * Extra RouterOS commands run at provisioning. Admins only: null for managers, since it may
   * hold credentials.
   */
  provisioningCommand: string | null;
  /** The router's address in the management tunnel, once allocated. */
  tunnelAddress: string | null;
  rosVersion: string | null;
  architecture: string | null;
  provisionedAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
  uptimeSeconds: number;
  connectedDevices: number;
  status: RouterStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `GET /api/routers`. */
export interface RouterList {
  routers: RouterRecord[];
}

/** `GET` and `PUT /api/routers/:id`, `POST /api/routers`, and `POST /api/routers/:id/sync`. */
export interface RouterResponse {
  router: RouterRecord;
}

/** `GET /api/routers/provisioning-backlog`: guests waiting on a router, in the caller's venues. */
export interface ProvisioningBacklog {
  stuckVouchers: number;
  unprovisionedPayments: number;
}

/**
 * `POST /api/routers/:id/bootstrap-script`. Carries the router's API password, the one response
 * that does: it has to be typed into the router.
 */
export interface BootstrapScriptResponse {
  script: string;
  warnings: string[];
  resolved: {
    routerName: string;
    ipAddress: string;
    lanCidr: string;
    gatewayIp: string;
    apiUsername: string;
    apiPassword: string;
    apiPort: number;
    ssid: string;
    apiPasswordGenerated: boolean;
  };
  /** Whether the script opens the management tunnel. */
  tunnel: boolean;
}

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

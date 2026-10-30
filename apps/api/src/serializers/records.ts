import type {
  PackageRecord,
  PortalSettingsRecord,
  RouterRecord,
  SessionRecord,
  VenueRecord,
  VoucherRecord,
} from "@hashifi/types";
import type {
  Package,
  PortalSetting,
  Router,
  Venue,
  Voucher,
  WifiSession,
} from "../generated/prisma/client.js";

/**
 * The only place database rows become API records (`@hashifi/types`): decimals as strings,
 * timestamps as ISO 8601 UTC, byte counters as numbers. Each function returns the full record
 * type, so a field added to either side fails the typecheck until it is mapped.
 */

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** Byte counters fit in a JavaScript number far beyond any voucher (2^53 bytes is 8 PB). */
export function bytes(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Byte counter exceeds 2^53");
  return Number(value);
}

export function packageRecord(row: Package): PackageRecord {
  return {
    id: row.id,
    name: row.name,
    packageType: row.packageType,
    description: row.description,
    durationMinutes: row.durationMinutes,
    downloadSpeedMbps: row.downloadSpeedMbps,
    uploadSpeedMbps: row.uploadSpeedMbps,
    dataLimitGb: row.dataLimitGb,
    deviceLimit: row.deviceLimit,
    priceTsh: row.priceTsh.toFixed(2),
    features: row.features,
    isActive: row.isActive,
    throttledDownloadMbps: row.throttledDownloadMbps,
    throttledUploadMbps: row.throttledUploadMbps,
    peakStartHour: row.peakStartHour,
    peakEndHour: row.peakEndHour,
    throttleAfterGb: row.throttleAfterGb,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function voucherRecord(row: Voucher): VoucherRecord {
  return {
    id: row.id,
    batchId: row.batchId,
    packageId: row.packageId,
    venueId: row.venueId,
    redeemedByDeviceId: row.redeemedByDeviceId,
    code: row.code,
    status: row.status,
    dataLimitGb: row.dataLimitGb,
    dataUsedBytes: bytes(row.dataUsedBytes),
    durationMinutes: row.durationMinutes,
    priceTsh: row.priceTsh.toFixed(2),
    activatedAt: isoOrNull(row.activatedAt),
    expiresAt: isoOrNull(row.expiresAt),
    revokedAt: isoOrNull(row.revokedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function portalSettingsRecord(row: PortalSetting): PortalSettingsRecord {
  return {
    brandName: row.brandName,
    logoText: row.logoText,
    logoUrl: row.logoUrl,
    backgroundImageUrl: row.backgroundImageUrl,
    headline: row.headline,
    message: row.message,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    backgroundColor: row.backgroundColor,
    backgroundStyle: row.backgroundStyle,
    radius: row.radius,
    voucherLabel: row.voucherLabel,
    voucherPrefix: row.voucherPrefix,
    voucherHelp: row.voucherHelp,
    ticketTitle: row.ticketTitle,
    ticketFooter: row.ticketFooter,
    requireTerms: row.requireTerms,
    isActive: row.isActive,
    updatedAt: iso(row.updatedAt),
  };
}

export function venueRecord(row: Venue, routerCount: number): VenueRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    address: row.address,
    road: row.road,
    street: row.street,
    ward: row.ward,
    district: row.district,
    city: row.city,
    region: row.region,
    country: row.country,
    postalCode: row.postalCode,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    latitude: row.latitude?.toString() ?? null,
    longitude: row.longitude?.toString() ?? null,
    operatorId: row.operatorId,
    status: row.status,
    routerCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** An allowlist, so a column added later (a key, a secret) stays out until it is mapped. */
export function routerRecord(
  row: Router & { venue: { name: string } },
  audience: "admin" | "manager",
): RouterRecord {
  return {
    id: row.id,
    venueId: row.venueId,
    venueName: row.venue.name,
    name: row.name,
    model: row.model,
    identity: row.identity,
    ipAddress: row.ipAddress,
    hotspotGatewayIp: row.hotspotGatewayIp,
    macAddress: row.macAddress,
    apiUsername: row.apiUsername,
    hasApiPassword: row.apiPasswordEncrypted !== null,
    enableHotspot: row.enableHotspot,
    hotspotName: row.hotspotName,
    hotspotInterface: row.hotspotInterface,
    ssid: row.ssid,
    networkRange: row.networkRange,
    provisioningCommand: audience === "admin" ? row.provisioningCommand : null,
    tunnelAddress: row.tunnelAddress,
    rosVersion: row.rosVersion,
    architecture: row.architecture,
    provisionedAt: isoOrNull(row.provisionedAt),
    lastSeenAt: isoOrNull(row.lastSeenAt),
    uptimeSeconds: row.uptimeSeconds,
    connectedDevices: row.connectedDevices,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function sessionRecord(
  row: WifiSession & {
    voucher: { code: string } | null;
    package: { name: string } | null;
    venue: { name: string } | null;
    router: { name: string } | null;
  },
): SessionRecord {
  return {
    id: row.id,
    status: row.status,
    deviceId: row.deviceId,
    macAddress: row.macAddress,
    ipAddress: row.ipAddress,
    deviceName: row.deviceName,
    deviceType: row.deviceType,
    voucherId: row.voucherId,
    voucherCode: row.voucher?.code ?? null,
    packageId: row.packageId,
    packageName: row.package?.name ?? null,
    venueId: row.venueId,
    venueName: row.venue?.name ?? null,
    routerId: row.routerId,
    routerName: row.router?.name ?? null,
    startedAt: iso(row.startedAt),
    endedAt: isoOrNull(row.endedAt),
    durationSeconds: row.durationSeconds,
    uploadBytes: bytes(row.uploadBytes),
    downloadBytes: bytes(row.downloadBytes),
    uploadSpeedMbps: row.uploadSpeedMbps?.toFixed(2) ?? null,
    downloadSpeedMbps: row.downloadSpeedMbps?.toFixed(2) ?? null,
    signalStrengthDbm: row.signalStrengthDbm,
    isThrottled: row.isThrottled,
    terminationReason: row.terminationReason,
  };
}

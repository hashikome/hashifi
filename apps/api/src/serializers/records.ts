import type { PackageRecord, PortalSettingsRecord, VoucherRecord } from "@hashifi/types";
import type { Package, PortalSetting, Voucher } from "../generated/prisma/client.js";

/**
 * The only place database rows become API records (`@hashifi/types`): decimals as strings,
 * timestamps as ISO 8601 UTC, byte counters as numbers. Each function returns the full record
 * type, so a field added to either side fails the typecheck until it is mapped.
 */

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** Byte counters fit in a JavaScript number far beyond any voucher (2^53 bytes is 8 PB). */
function bytes(value: bigint): number {
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
    id: row.id,
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
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

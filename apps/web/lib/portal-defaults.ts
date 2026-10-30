import type { PortalSettings } from "./types";

/**
 * Fallback portal branding, used to render previews before any real settings are loaded.
 *
 * Extracted from the deleted `lib/mock/data.ts` — it was the only export in that file anything
 * still imported. Not mock data in the placeholder sense: `voucher-preview` genuinely needs a
 * complete `PortalSettings` to draw a voucher, and these are the defaults it draws with.
 */
export const initialPortalSettings: PortalSettings = {
  brandName: "SkyNet Hotspot",
  venueName: "Downtown Mall",
  headline: "Welcome to fast WiFi",
  message: "Choose a plan or enter your voucher to get secure internet access.",
  primaryColor: "#D97757",
  accentColor: "#0F766E",
  backgroundColor: "#1F2937",
  backgroundStyle: "soft",
  radius: 18,
  authMode: "voucher",
  voucherLabel: "Voucher code",
  voucherPrefix: "WIFI",
  voucherHelp: "Ask the cashier for a voucher or buy one with mobile money.",
  ticketTitle: "Internet Access Voucher",
  ticketFooter: "Valid only at selected venue hotspots.",
  showPackages: true,
  showMpesa: true,
  requirePhone: true,
  requireTerms: true,
};

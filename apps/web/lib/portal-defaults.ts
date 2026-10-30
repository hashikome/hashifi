import type { PortalSettingsRecord } from "@hashifi/types";

/**
 * Settings to draw a voucher with before the real ones load, or if they cannot. The API's own
 * defaults (`GET /api/portal`) apply everywhere else.
 */
export const initialPortalSettings: PortalSettingsRecord = {
  brandName: "HashiFi",
  headline: "Welcome to fast WiFi",
  message: "Buy time with mobile money, or enter the voucher you were given.",
  primaryColor: "#0F766E",
  accentColor: "#134E4A",
  backgroundColor: "#134E4A",
  backgroundStyle: "soft",
  radius: 18,
  voucherLabel: "Voucher code",
  voucherPrefix: "WIFI",
  voucherHelp: "Ask at the counter for a voucher, or buy one with mobile money.",
  ticketTitle: "Internet Access Voucher",
  ticketFooter: "Thank you for your purchase",
  requireTerms: true,
  isActive: true,
  updatedAt: null,
};

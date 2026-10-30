import type { PortalSettingsRecord } from "@hashifi/types";
import { z } from "zod";

/** The HashiFi default, until an admin saves another; a venue may set its own. */
export const DEFAULT_PORTAL_SETTINGS: PortalSettingsRecord = {
  brandName: "HashiFi",
  headline: "Welcome to fast WiFi",
  message: "Buy time with mobile money, or enter the voucher you were given.",
  primaryColor: "#0F766E",
  accentColor: "#134E4A",
  backgroundColor: "#134E4A",
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

/** One line, no control characters: these reach the portal page and printed cards. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text");
/** Paragraph text: line breaks allowed, other control characters not. */
const paragraph = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (text) => [...text].every((c) => c === "\n" || /^[^\p{Cc}]$/u.test(c)),
      "cannot contain control characters",
    );
const colour = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "must be a colour such as #0F766E");
/** The whole branding, as the portal page's form sends it. */
export const portalInput = z.object({
  brandName: line(160).min(1, "is required"),
  headline: line(180).min(1, "is required"),
  message: paragraph(1000),
  primaryColor: colour,
  accentColor: colour,
  backgroundColor: colour,
  radius: z.number().int("must be a whole number").min(0).max(32),
  voucherLabel: line(100).min(1, "is required"),
  voucherPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,12}$/, "letters and digits only, up to 12"),
  voucherHelp: paragraph(500),
  ticketTitle: line(160).min(1, "is required"),
  ticketFooter: line(255),
  requireTerms: z.boolean(),
  isActive: z.boolean().default(true),
});

export type PortalInput = z.infer<typeof portalInput>;

/** What a venue sets for itself. */
export const brandInput = portalInput.omit({ isActive: true });

export type BrandInput = z.infer<typeof brandInput>;

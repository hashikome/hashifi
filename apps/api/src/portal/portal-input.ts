import type { PortalSettingsRecord } from "@hashifi/types";
import { z } from "zod";

/** Where `GET /api/portal/images/:id` serves an image from. */
export const IMAGE_PATH = "/api/portal/images/";
const IMAGE_URL =
  /^\/api\/portal\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The branding the portal shows until an admin saves their own. */
export const DEFAULT_PORTAL_SETTINGS: PortalSettingsRecord = {
  brandName: "HashiFi",
  logoText: "H",
  logoUrl: null,
  backgroundImageUrl: null,
  headline: "Welcome to fast WiFi",
  message: "Buy time with mobile money, or enter the voucher you were given.",
  primaryColor: "#D97757",
  accentColor: "#0F766E",
  backgroundColor: "#1F2937",
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
  .regex(/^#[0-9A-Fa-f]{6}$/, "must be a colour such as #D97757");
/** Only an image HashiFi stored, so the portal never loads an address an admin pasted. */
const image = z
  .string()
  .regex(IMAGE_URL, "must be an image uploaded here")
  .nullable()
  .default(null);

/** The whole branding, as the portal page's form sends it. */
export const portalInput = z.object({
  brandName: line(160).min(1, "is required"),
  logoText: line(8).min(1, "is required"),
  logoUrl: image,
  backgroundImageUrl: image,
  headline: line(180).min(1, "is required"),
  message: paragraph(1000),
  primaryColor: colour,
  accentColor: colour,
  backgroundColor: colour,
  backgroundStyle: z.enum(["solid", "soft", "split"]),
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
  isActive: z.boolean(),
});

export type PortalInput = z.infer<typeof portalInput>;

export const imageKindQuery = z.object({ kind: z.enum(["logo", "background"]) });

/** The image id in a stored URL. */
export function imageIdOf(url: string | null): string | null {
  return url === null ? null : url.slice(IMAGE_PATH.length);
}

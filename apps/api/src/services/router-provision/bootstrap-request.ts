import { z } from "zod";

// Control characters would break the pasted script; the quoting handles everything else.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The bootstrap-script request. `buildBootstrapScript` trusts its input and only *warns* about
 * things it can still generate a script for (a gateway outside the subnet, say); this schema is the
 * layer that refuses input outright, so it is where "bad input is rejected" is proved.
 */
export const bootstrapSchema = z.object({
  routerName: z.string().min(1).max(160),
  ipAddress: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/, "Must be an IPv4 address"),
  lanPrefix: z.coerce.number().int().min(8).max(30).optional(),
  gatewayIp: z
    .string()
    .regex(/^(\d{1,3}(\.\d{1,3}){3})?$/, "Must be an IPv4 address")
    .optional(),
  apiUsername: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/, "Usernames cannot contain spaces or quotes"),
  apiPassword: z
    .string()
    .max(200)
    .refine((v) => !CONTROL_CHARACTERS.test(v), "Password cannot contain control characters")
    .optional(),
  adminPassword: z
    .string()
    .max(200)
    .refine((v) => !CONTROL_CHARACTERS.test(v), "Password cannot contain control characters")
    .optional(),
  ssid: z
    .string()
    .max(32)
    .refine((v) => !CONTROL_CHARACTERS.test(v), "SSID cannot contain control characters")
    .optional(),
});

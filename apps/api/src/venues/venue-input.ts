import { z } from "zod";

/** One line of text: trimmed, no control characters (names reach printed vouchers and the portal). */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, "must be one line of text");

/** Optional text: absent, null and empty all mean "none". */
const optionalLine = (max: number) =>
  line(max)
    .nullable()
    .default(null)
    .transform((value) => (value === "" ? null : value));

/**
 * A venue as the admin enters it, for create and for update alike: the form always sends the
 * whole venue, so an absent optional field is cleared rather than left as it was.
 */
export const venueInput = z.object({
  name: line(180).min(1, "is required"),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .default(null)
    .transform((value) => (value === "" ? null : value)),
  address: optionalLine(255),
  road: optionalLine(120),
  street: optionalLine(120),
  ward: optionalLine(120),
  district: optionalLine(120),
  city: line(120).min(1, "is required"),
  region: line(120).min(1, "is required"),
  country: line(120).min(1, "is required").default("Tanzania"),
  postalCode: optionalLine(30),
  contactPhone: optionalLine(32),
  contactEmail: z
    .union([z.literal(""), z.email().max(255)])
    .nullable()
    .default(null)
    .transform((value) => (value === "" || value === null ? null : value.toLowerCase())),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
  operatorId: z.uuid().nullable().default(null),
});

export type VenueInput = z.infer<typeof venueInput>;

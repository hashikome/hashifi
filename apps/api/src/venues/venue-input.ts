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
 * whole venue, so an absent optional field is cleared rather than left as it was. Who operates
 * it is not here: that is set on the Team page, and a venue save leaves it alone.
 */
export const venueInput = z.object({
  name: line(180).min(1, "is required"),
  address: optionalLine(255),
  city: line(120).min(1, "is required"),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
});

export type VenueInput = z.infer<typeof venueInput>;

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
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A pasted address reduced to its host name, as the router's walled garden takes it. */
const allowedSite = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^https?:\/\//, "").replace(/[/?#:].*$/, ""))
  .refine((value) => HOST_NAME.test(value), "must be a site's address, such as hotel.co.tz");

export const venueInput = z.object({
  name: line(180).min(1, "is required"),
  address: optionalLine(255),
  allowedSites: z
    .array(allowedSite)
    .max(20)
    .default([])
    .transform((sites) => [...new Set(sites)]),
  city: line(120).min(1, "is required"),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
});

export type VenueInput = z.infer<typeof venueInput>;

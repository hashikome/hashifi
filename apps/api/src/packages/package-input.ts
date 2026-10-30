import { z } from "zod";

/** The lowest price HashiFi sells a package for, in whole shillings. */
export const MINIMUM_PRICE_TSH = 1_000;

const whole = (min: number, max: number) =>
  z
    .number({ error: (issue) => (issue.code === "invalid_type" ? "must be a number" : null) })
    .int("must be a whole number")
    .min(min)
    .max(max);
const optionalWhole = (min: number, max: number) => whole(min, max).nullable().default(null);

/**
 * A package as the admin enters it, for create and for update alike (the form sends the whole
 * package). Every rule the form pre-checks is enforced here, together with the ones that make
 * throttling mean something: a throttled speed needs something that triggers it, and a trigger
 * needs a throttled speed, or the router would never apply either.
 */
export const packageInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "is required")
      .max(180)
      .regex(/^[^\p{Cc}]*$/u, "must be one line of text"),
    packageType: z.enum(["hotspot", "home", "business", "premium"]).default("hotspot"),
    description: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .default(null)
      .transform((v) => (v === "" ? null : v)),
    /** One minute to one year: a typo of 100000 would otherwise never expire. */
    durationMinutes: whole(1, 525_600),
    downloadSpeedMbps: whole(1, 10_000),
    uploadSpeedMbps: optionalWhole(1, 10_000),
    dataLimitGb: optionalWhole(1, 100_000),
    deviceLimit: whole(1, 100).default(1),
    priceTsh: whole(MINIMUM_PRICE_TSH, 10_000_000),
    features: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    isActive: z.boolean().default(true),
    throttledDownloadMbps: optionalWhole(1, 10_000),
    throttledUploadMbps: optionalWhole(1, 10_000),
    peakStartHour: optionalWhole(0, 23),
    peakEndHour: optionalWhole(0, 23),
    throttleAfterGb: optionalWhole(1, 100_000),
  })
  .superRefine((p, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const throttled = p.throttledDownloadMbps !== null;
    const peak = p.peakStartHour !== null || p.peakEndHour !== null;

    if (throttled && p.throttledDownloadMbps !== null) {
      if (p.throttledDownloadMbps >= p.downloadSpeedMbps) {
        issue(
          "throttledDownloadMbps",
          `must be below the download speed (${p.downloadSpeedMbps} Mbps)`,
        );
      }
      const upload = p.uploadSpeedMbps ?? p.downloadSpeedMbps;
      if (p.throttledUploadMbps !== null && p.throttledUploadMbps >= upload) {
        issue("throttledUploadMbps", `must be below the upload speed (${upload} Mbps)`);
      }
      if (!peak && p.throttleAfterGb === null) {
        issue("throttledDownloadMbps", "needs peak hours or a data threshold to apply it");
      }
    } else {
      if (p.throttledUploadMbps !== null)
        issue("throttledUploadMbps", "needs a throttled download speed");
      if (peak) issue("peakStartHour", "peak hours need a throttled download speed");
      if (p.throttleAfterGb !== null) issue("throttleAfterGb", "needs a throttled download speed");
    }
    if (peak && (p.peakStartHour === null || p.peakEndHour === null)) {
      issue(
        p.peakStartHour === null ? "peakStartHour" : "peakEndHour",
        "set both peak hours, or neither",
      );
    } else if (peak && p.peakStartHour === p.peakEndHour) {
      issue("peakEndHour", "must differ from the start hour");
    }
    if (
      p.throttleAfterGb !== null &&
      p.dataLimitGb !== null &&
      p.throttleAfterGb >= p.dataLimitGb
    ) {
      issue("throttleAfterGb", `must be below the data limit (${p.dataLimitGb} GB)`);
    }
  });

export type PackageInput = z.infer<typeof packageInput>;

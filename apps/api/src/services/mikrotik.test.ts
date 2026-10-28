import { describe, expect, test } from "bun:test";
import {
  packageCanThrottle,
  rateLimitFor,
  throttledProfileNameForPackage,
  throttledRateLimitFor,
  userProfileNameForPackage,
} from "./mikrotik.js";

/**
 * The speed-cap path.
 *
 * On a board that rejects per-user `rate-limit` (an hAP lite does), the cap has to ride a per-package
 * hotspot **user profile**. Before 2026-08-12 nothing sent `=profile=` at all, so every voucher sat
 * on `default` uncapped while Set up reported `ok: true` — a paying customer getting the full uplink.
 */

describe("userProfileNameForPackage", () => {
  const id = "823857f0-4384-4629-ab27-2a4c5d4f1952";

  test("is derived from the package id, not its name", () => {
    // A renamed package must keep using the profile its vouchers already point at.
    expect(userProfileNameForPackage(id)).toBe(`wbs-pkg-${id}`);
  });

  test("carries the wbs- prefix, the only tag available here", () => {
    // `/ip hotspot user profile` rejects `comment` outright — measured on the hAP lite — so the
    // name prefix is the whole idempotency contract for this menu.
    expect(userProfileNameForPackage(id).startsWith("wbs-")).toBe(true);
  });

  test("is stable and unique per package", () => {
    expect(userProfileNameForPackage(id)).toBe(userProfileNameForPackage(id));
    expect(userProfileNameForPackage("a")).not.toBe(userProfileNameForPackage("b"));
  });

  test("stays within a length RouterOS accepts", () => {
    // 44 characters for a UUID. Verified accepted and read back unchanged on an hAP lite (7.23.2);
    // this guards against someone lengthening the prefix past what the board tolerates.
    expect(userProfileNameForPackage(id).length).toBeLessThanOrEqual(64);
  });
});

describe("rateLimitFor", () => {
  test("is up/down, in that order — RouterOS reads rate-limit as upload/download", () => {
    // Getting this backwards would silently throttle downloads to the upload figure.
    expect(rateLimitFor({ downloadSpeedMbps: 10, uploadSpeedMbps: 2 })).toBe("2M/10M");
  });

  test("mirrors the download speed when no upload is set", () => {
    expect(rateLimitFor({ downloadSpeedMbps: 5, uploadSpeedMbps: null })).toBe("5M/5M");
  });

  test.each([0, -1])("returns null for a download speed of %s, rather than a 0M cap", (speed) => {
    // "0M/0M" would be a real rule blocking everything, not an absent one.
    expect(rateLimitFor({ downloadSpeedMbps: speed, uploadSpeedMbps: null })).toBeNull();
  });
});

describe("throttledProfileNameForPackage", () => {
  test("is a distinct profile from the package's normal one", () => {
    const id = "0198f2b4-1c3a-7c9e-9f2b-3d4e5f6a7b8c";
    // Editing the shared wbs-pkg-<id> profile to throttle one customer would throttle everyone
    // on that package — the whole reason the throttled state needs its own profile.
    expect(throttledProfileNameForPackage(id)).not.toBe(userProfileNameForPackage(id));
  });

  test("stays inside the length RouterOS accepts for a profile name", () => {
    const id = "0198f2b4-1c3a-7c9e-9f2b-3d4e5f6a7b8c";
    expect(throttledProfileNameForPackage(id).length).toBeLessThanOrEqual(64);
  });

  test("is the same length as the verified normal name", () => {
    // wbs-pkg-<uuid> at 44 chars is measured-accepted on the hAP lite. Keeping the throttled twin
    // identical in length means it cannot be the thing a board rejects, which is not something to
    // find out at a peak-hour boundary on a live router.
    const id = "0198f2b4-1c3a-7c9e-9f2b-3d4e5f6a7b8c";
    expect(throttledProfileNameForPackage(id)).toHaveLength(userProfileNameForPackage(id).length);
  });

  test("keeps the wbs- prefix that marks it as ours to manage", () => {
    // The idempotency contract: only wbs-tagged objects are ever modified or removed.
    expect(throttledProfileNameForPackage("abc")).toStartWith("wbs-");
  });
});

describe("packageCanThrottle", () => {
  test("needs a throttled download speed to mean anything", () => {
    expect(packageCanThrottle({ throttledDownloadMbps: null })).toBe(false);
  });

  test.each([0, -1])("rejects %s, which would be a block rather than a throttle", (speed) => {
    expect(packageCanThrottle({ throttledDownloadMbps: speed })).toBe(false);
  });

  test("is true once a throttled speed is set", () => {
    expect(packageCanThrottle({ throttledDownloadMbps: 2 })).toBe(true);
  });
});

describe("throttledRateLimitFor", () => {
  test("is up/down, matching rateLimitFor's argument order", () => {
    expect(
      throttledRateLimitFor({ throttledDownloadMbps: 2, throttledUploadMbps: 1 }),
    ).toBe("1M/2M");
  });

  test("mirrors the throttled download when no throttled upload is set", () => {
    // Not "leave upload uncapped" — that would let a throttled customer keep full upload.
    expect(
      throttledRateLimitFor({ throttledDownloadMbps: 2, throttledUploadMbps: null }),
    ).toBe("2M/2M");
  });

  test("returns null when the package has no throttle configured", () => {
    expect(
      throttledRateLimitFor({ throttledDownloadMbps: null, throttledUploadMbps: 5 }),
    ).toBeNull();
  });
});

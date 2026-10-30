import { describe, expect, test } from "bun:test";
import { needsProfileLimits } from "./router-sync.js";

/**
 * When must a voucher's limits ride a hotspot user profile instead of the user itself?
 *
 * Getting this wrong in either direction is bad: too eager and every router accumulates profiles it
 * does not need; too shy and the voucher has no cap at all, which is what happened before
 * 2026-08-12 — `=profile=` was never sent, so vouchers sat on `default` and customers got the full
 * uplink while Set up reported `ok: true`.
 */
describe("needsProfileLimits", () => {
  test("a board accepting both keeps limits on the user", () => {
    expect(needsProfileLimits({ userRateLimit: true, userSharedUsers: true })).toBe(false);
  });

  test("rejecting rate-limit needs the profile — the speed cap has nowhere else to go", () => {
    expect(needsProfileLimits({ userRateLimit: false, userSharedUsers: true })).toBe(true);
  });

  test("rejecting shared-users needs it too — the device limit has nowhere else to go", () => {
    expect(needsProfileLimits({ userRateLimit: true, userSharedUsers: false })).toBe(true);
  });

  test("rejecting both needs it", () => {
    expect(needsProfileLimits({ userRateLimit: false, userSharedUsers: false })).toBe(true);
  });

  test("an unprobed router stays optimistic rather than creating profiles speculatively", () => {
    /*
     * null means nobody has probed this board. Staying optimistic costs at most one rejected
     * round-trip, which `createHotspotUser` already retries past; guessing the other way would
     * leave a profile on every router that never needed one, and profiles cannot carry a comment
     * so there is no way to explain them to whoever finds them.
     */
    expect(needsProfileLimits(null)).toBe(false);
  });
});

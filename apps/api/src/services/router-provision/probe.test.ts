import { describe, expect, test } from "bun:test";
import type { RouterCapabilities } from "./probe.js";
import { mergeCapabilities } from "./probe.js";

/**
 * The one-way capability latch.
 *
 * `deriveCapabilities` guesses user-level `rate-limit`/`shared-users` from the RouterOS major
 * version, and on real hardware that guess is wrong: an hAP lite on 7.23.2 rejects both. Only
 * `verify.ts` can find out, by trying. So every probe that persists capabilities must go through
 * `mergeCapabilities`, or the next probe's optimistic *guess* silently overwrites a *measurement*
 * and every voucher sold on that router pays for a failed round-trip first.
 *
 * The consequence when this broke: vouchers on that board carried no speed cap at all.
 */

const probed = (over: Partial<RouterCapabilities> = {}): RouterCapabilities => ({
  hotspot: true,
  toolFetch: true,
  userRateLimit: true,
  userSharedUsers: true,
  ...over,
});

describe("mergeCapabilities", () => {
  test("a measured false is never clobbered by a guessed true", () => {
    const merged = mergeCapabilities(
      { userRateLimit: false, userSharedUsers: false },
      probed({ userRateLimit: true, userSharedUsers: true }),
    );
    expect(merged.userRateLimit).toBe(false);
    expect(merged.userSharedUsers).toBe(false);
  });

  test("the latch is per-field", () => {
    const merged = mergeCapabilities({ userRateLimit: false }, probed());
    expect(merged.userRateLimit).toBe(false);
    expect(merged.userSharedUsers).toBe(true);
  });

  test("a stored true does not pin a field — only false latches", () => {
    // One-way by design: a board that starts accepting a parameter (firmware upgrade) must be
    // able to report so, and only `false` is ever a measurement.
    const merged = mergeCapabilities({ userRateLimit: true }, probed({ userRateLimit: false }));
    expect(merged.userRateLimit).toBe(false);
  });

  test("hotspot is deliberately NOT latched, so a reinstalled package is seen", () => {
    // RouterOS 7.20+ dropped hotspot from the core build on smips. Latching a missing package
    // would mean installing the .npk could never be detected.
    expect(mergeCapabilities({ hotspot: false }, probed({ hotspot: true })).hotspot).toBe(true);
  });

  test("no stored capabilities means take the probe as-is", () => {
    for (const stored of [null, undefined, "", 0, "not-json", []]) {
      expect(mergeCapabilities(stored, probed())).toEqual(probed());
    }
  });

  test("a partial stored object does not drop probed fields", () => {
    const merged = mergeCapabilities({ userRateLimit: false }, probed());
    expect(merged.hotspot).toBe(true);
    expect(merged.toolFetch).toBe(true);
  });

  test("the probe wins for everything the latch does not cover", () => {
    const merged = mergeCapabilities(
      { toolFetch: true, hotspot: true },
      probed({ toolFetch: false, hotspot: false }),
    );
    expect(merged.toolFetch).toBe(false);
    expect(merged.hotspot).toBe(false);
  });
});

describe("probeRouterMerged is the only way callers build a profile", () => {
  /**
   * A source-level check, deliberately.
   *
   * `mergeCapabilities` being correct is not enough — the 2026-08-12 bug was a *call site* that
   * skipped it. `setup.ts` phase 1 took the raw probe, so phases 3-5 (which merged) and phase 6
   * (which did not) held two different views of the same board, and every run re-sent parameters
   * the board had already rejected. The rule was already written in CLAUDE.md; a unit test on the
   * merge function could never have caught it.
   *
   * `probe.ts` itself calls `probeRouter` — that is the implementation. Everywhere else that has a
   * stored row must go through `probeRouterMerged`.
   */
  const CALLERS = ["setup.ts", "index.ts", "../../routes/routers.ts"];

  for (const file of CALLERS) {
    test(`${file} does not call probeRouter directly`, async () => {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      // Strip comments so prose mentioning the name does not trip this.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code).not.toMatch(/\bprobeRouter\s*\(/);
      expect(code).toMatch(/\bprobeRouterMerged\s*\(/);
    });
  }
});

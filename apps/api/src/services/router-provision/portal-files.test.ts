import { describe, expect, test } from "bun:test";
import { PORTAL_FILES, renderPortalFile, routerPathFor } from "./portal-files.js";

/**
 * The hotspot pages are the only code in this system that runs on a customer's phone, served by the
 * router, with no build step and no way to see an error. Everything cheap to assert about them is
 * asserted here.
 */

const rendered = async (name: (typeof PORTAL_FILES)[number]) =>
  renderPortalFile(name, "http://10.0.0.9:9000", "router-1");

describe("every page", () => {
  test("all three are registered", () => {
    expect([...PORTAL_FILES]).toEqual(["login.html", "alogin.html", "status.html"]);
  });

  test.each([...PORTAL_FILES])("%s is served from hotspot/", (name) => {
    expect(routerPathFor(name)).toBe(`hotspot/${name}`);
  });

  test.each([...PORTAL_FILES])("%s has the backend URL rewritten", async (name) => {
    const html = await rendered(name);
    // The repo copies carry a hardcoded 192.168.0.15:8080; nothing may survive templating, or the
    // page would call an address that only exists on one developer's desk (§3.1, §10).
    expect(html).not.toContain("192.168.0.15");
    expect(html).toContain("http://10.0.0.9:9000");
  });

  test.each([...PORTAL_FILES])("%s balances its RouterOS conditionals", async (name) => {
    const html = await rendered(name);
    const count = (re: RegExp) => (html.match(re) ?? []).length;
    // An unclosed $(if …) makes RouterOS emit the raw template text at the customer.
    expect(count(/\$\(if\s/g)).toBe(count(/\$\(endif\)/g));
  });
});

describe("status.html", () => {
  /**
   * RouterOS substitutes `$(name)` **anywhere** in the file — comments and script bodies included.
   * A stray jQuery-style call would be silently replaced with nothing, so the whitelist below is
   * the real constraint on this file, not a style preference.
   */
  test("contains no dollar-parenthesis sequence that is not a RouterOS variable", async () => {
    const html = await rendered("status.html");
    const allowed = new Set([
      "if",
      "elif",
      "else",
      "endif",
      "mac",
      "ip",
      "username",
      "uptime",
      "session-time-left",
      "bytes-in-nice",
      "bytes-out-nice",
      "link-logout",
      "link-advert",
      "login-by",
      "login-by-mac",
      "blocked",
      "refresh-timeout",
      "refresh-timeout-secs",
    ]);
    for (const match of html.matchAll(/\$\(([a-z-]*)/g)) {
      expect(allowed).toContain(match[1]);
    }
  });

  test("keeps the logout path, the page's only action", async () => {
    const html = await rendered("status.html");
    expect(html).toContain("$(link-logout)");
    // The stock page opened a popup window, which mobile browsers block — a real form submit is
    // what makes Disconnect work on a phone.
    expect(html).toContain("<form");
    expect(html).not.toContain("window.open");
  });

  test("renders its figures server-side, so it works with the backend down", async () => {
    const html = await rendered("status.html");
    // A customer checking their remaining time is already online; the page must not depend on the
    // backend being reachable to say anything at all.
    for (const v of ["$(uptime)", "$(ip)", "$(mac)", "$(bytes-in-nice)"]) {
      expect(html).toContain(v);
    }
  });

  test("shows when the session runs out, not only how long is left", async () => {
    const html = await rendered("status.html");
    // "2h 14m left" says how long; "runs out today at 9:42 pm" says whether that covers the trip
    // home. Both branches of the time conditional carry the note, so it is present either way.
    expect(html).toContain('id="expires-note"');
    expect(html).toContain("Runs out ");
    // Computed from the phone's clock, never the router's — a MikroTik with no NTP client can be
    // weeks out, and the customer compares this against their own phone.
    expect(html).toContain("Date.now() + secondsLeft * 1000");
    // …and upgraded to the database's real wall-clock expiry when the backend answers.
    expect(html).toContain("data.time.expiresAt");
  });

  test("is self-contained — no external assets the router does not have", async () => {
    const html = await rendered("status.html");
    // The stock page linked css/style.css. We upload one file, so anything external is a broken
    // reference on a device with no internet until it logs in.
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });
});

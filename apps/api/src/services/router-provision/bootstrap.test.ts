import { describe, expect, test } from "bun:test";
import { buildBootstrapScript, rosQuote } from "./bootstrap.js";
import { bootstrapSchema } from "../../routes/routers.js";

const VALID = {
  routerName: "Bloc 3 Main Router",
  ipAddress: "192.168.0.161",
  apiUsername: "billing-api",
  apiPassword: "DBB_GXuELRUAtgDLpnykqTcg",
  gatewayIp: "192.168.0.1",
  ssid: "VenueWiFi",
  lanPrefix: 24,
};

const build = (over: Partial<typeof VALID> & Record<string, unknown> = {}) =>
  buildBootstrapScript({ ...VALID, ...over } as Parameters<typeof buildBootstrapScript>[0]);

/** Statement lines only — comments and blanks are never executed, so their length is irrelevant. */
const statements = (script: string) =>
  script.split("\n").filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));

describe("generated script fits the RouterOS console", () => {
  /**
   * The regression this file exists for.
   *
   * On 2026-08-12 the radio stanza (§7) was a single 1038-character line: the legacy branch, the
   * wifi branch, the wifiwave2 fallback and three failure messages all inlined, each carrying a
   * doubly-escaped `:parse` copy of a command. The RouterOS console's input line limit is ~1024
   * bytes, so pasting it truncated the line mid-string. It failed silently — the syntax error
   * scrolled past in a terminal whose session had already dropped when the bridge came up — and
   * the radio was left disabled on a board where every other step had applied. The only visible
   * symptom was "wlan1 is currently disabled" two screens later in a different tool.
   *
   * 512 is half the limit, so even a long SSID or router name cannot push a line over.
   */
  const MAX = 512;

  test("no statement exceeds the console's line limit", () => {
    const long = build({
      routerName: "A".repeat(60),
      ssid: "S".repeat(32),
      apiPassword: "p".repeat(64),
      adminPassword: "q".repeat(64),
    });
    for (const line of statements(long.script)) {
      expect(line.length).toBeLessThanOrEqual(MAX);
    }
  });

  test("one statement per line — no multi-line do={ } blocks", () => {
    // A trailing `{` with nothing closing it on the same line means the block spans lines, which
    // pastes unreliably into the WinBox terminal.
    for (const line of statements(build().script)) {
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  test("every statement is self-contained — no variable set by another line", () => {
    /*
     * In the interactive console each pasted line is its own command, so a `:local` on one line
     * being visible to the next is not something to rely on. `§7` used to do exactly that
     * (`:local legacyRadios` on one line, `$legacyRadios` on the next) and it was the other
     * candidate cause of the 2026-08-12 silent radio failure — a variable quietly resolving to
     * nothing is invisible until you notice the radio never came up.
     */
    // A $ in a password is escaped as `\$` and is not a variable reference — hence the lookbehind
    // below. Passing one here keeps this test from failing on a legitimate credential later.
    for (const line of statements(build({ adminPassword: "pa$$word$USER" }).script)) {
      const declared = new Set(
        [...line.matchAll(/:(?:local|set)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!),
      );
      // `:foreach x in=…` and `:for x from=…` bind their own variable too.
      for (const m of line.matchAll(/:(?:foreach|for)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        declared.add(m[1]!);
      }
      for (const m of line.matchAll(/(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
        expect(declared).toContain(m[1]!);
      }
    }
  });

  test("the generated scaffolding is pure ASCII, so Download .rsc + /import is byte-safe", () => {
    // Only the script's own text is guaranteed — a UTF-8 SSID passes through, and RouterOS
    // accepts one. This catches a smart quote or em-dash creeping into a comment or message,
    // which is what would actually corrupt an /import.
    expect(build().script).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
  });
});

describe("radio configuration", () => {
  test("branches on the board rather than assuming a stack", () => {
    const { script } = build();
    expect(script).toContain("/interface wireless set");
    expect(script).toContain("/interface wifi set");
    expect(script).toContain("/interface wifiwave2 set");
  });

  test("every optional menu is reached through :parse", () => {
    // Guarding with `:if` alone is not enough — the command path can fail to resolve when the line
    // is read, not when it runs.
    for (const menu of ["/interface wifi set", "/interface wifiwave2 set"]) {
      const line = statements(build().script).find((l) => l.includes(menu));
      expect(line).toBeDefined();
      expect(line!).toContain(":parse");
    }
  });

  test("says so out loud when a menu rejects the radio command", () => {
    const { script } = build();
    for (const menu of ["/interface wireless", "/interface wifi", "/interface wifiwave2"]) {
      expect(script).toContain(`${menu} rejected the radio command.`);
    }
  });

  test("a board with no radio is told what to do instead", () => {
    expect(build().script).toContain("No radio on this board");
  });

  test("reports the outcome, not just whether a command errored", () => {
    // A command returning without error is not proof the radio came up — the last line re-reads
    // the board and says so if a radio is still disabled.
    expect(build().script).toContain("Radio is still disabled");
  });

});

describe("quoting", () => {
  test("rosQuote escapes backslash, quote and $", () => {
    // $ matters as much as the others: RouterOS interpolates inside double quotes, so an
    // unescaped $ in a password silently sets a different password than the one we store.
    expect(rosQuote('a\\b"c$d')).toBe('a\\\\b\\"c\\$d');
  });

  test("a $ in the API password reaches the router escaped", () => {
    const { script } = build({ apiPassword: "pa$$word" });
    expect(script).toContain('password="pa\\$\\$word"');
    // …and never raw, which would expand to an empty variable.
    expect(script).not.toContain('password="pa$$word"');
  });

  test("commands embedded in :parse are escaped a second time", () => {
    // The command travels as a RouterOS string *containing* RouterOS source, so the quotes the
    // template puts around the SSID are themselves escaped. Getting this wrong corrupts SSIDs
    // rather than failing loudly, which is why it is pinned here.
    const line = statements(build().script).find((l) => l.includes("/interface wifi set"))!;
    expect(line).toContain('ssid=\\"VenueWiFi\\"');
  });

  test("a quote in the SSID survives both levels of escaping", () => {
    const line = statements(build({ ssid: 'The "Cafe"' }).script).find((l) =>
      l.includes("/interface wifi set"),
    )!;
    // rosQuote once → \"Cafe\" ; embedded in :parse → \\\"Cafe\\\"
    expect(line).toContain('\\\\\\"Cafe\\\\\\"');
  });
});

describe("hardware-agnostic", () => {
  test("discovers ethernet ports instead of listing ether1-4", () => {
    const { script } = build();
    expect(script).toContain("/interface ethernet find");
    expect(script).not.toContain("ether2");
  });

  test("removes a radio that is already a bridge port", () => {
    // Bridged, the hotspot gateway address collides and the portal silently never intercepts.
    expect(build().script).toContain("/interface bridge port remove");
  });

  test("ends by proving the router can reach the internet", () => {
    expect(build().script.trimEnd().endsWith("/ping 8.8.8.8 count=3")).toBe(true);
  });
});

describe("admin password", () => {
  test("is left alone when blank, so a re-paste never changes it silently", () => {
    const { script, warnings } = build();
    expect(script).not.toContain("/user set admin password=");
    expect(warnings.join(" ")).toContain("blank admin password");
  });

  test("is set when given", () => {
    expect(build({ adminPassword: "hunter2" }).script).toContain(
      '/user set admin password="hunter2"',
    );
  });
});

describe("the endpoint rejects bad input rather than emitting a broken script", () => {
  test("accepts a valid request", () => {
    expect(bootstrapSchema.safeParse(VALID).success).toBe(true);
  });

  const invalid: [string, Record<string, unknown>][] = [
    ["a non-IPv4 address", { ipAddress: "not-an-ip" }],
    ["an address with too few octets", { ipAddress: "192.168.0" }],
    ["a username containing a space", { apiUsername: "billing api" }],
    ["a username containing a quote", { apiUsername: 'billing"api' }],
    ["a password containing a newline", { apiPassword: "line1\nline2" }],
    ["a prefix below /8", { lanPrefix: 4 }],
    ["a prefix above /30", { lanPrefix: 31 }],
    ["an empty router name", { routerName: "" }],
  ];

  for (const [label, over] of invalid) {
    test(label, () => {
      expect(bootstrapSchema.safeParse({ ...VALID, ...over }).success).toBe(false);
    });
  }

  test("a gateway outside the subnet is a warning, not a rejection", () => {
    // It generates a usable script and says what is wrong — refusing would block the legitimate
    // case where the admin knows better than we do.
    expect(bootstrapSchema.safeParse({ ...VALID, gatewayIp: "10.0.0.1" }).success).toBe(true);
    expect(build({ gatewayIp: "10.0.0.1" }).warnings.join(" ")).toContain("not inside");
  });
});

describe("defaults", () => {
  test("falls back to the router name when no SSID is given", () => {
    const { script, resolved } = build({ ssid: undefined });
    expect(resolved.ssid).toBe(VALID.routerName);
    expect(script).toContain(`ssid=\\"${VALID.routerName}\\"`);
  });

  test("warns when it has to assume the upstream gateway", () => {
    const { warnings } = build({ gatewayIp: undefined });
    expect(warnings.join(" ")).toContain("192.168.0.1");
  });
});

import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.js";

const BASE = {
  DATABASE_URL: "postgresql://hashifi:hashifi@127.0.0.1:5437/hashifi",
  ENCRYPTION_KEY: "ab".repeat(32),
  BETTER_AUTH_SECRET: "cd".repeat(32),
};

describe("loadConfig", () => {
  test("defaults fill everything optional", () => {
    const config = loadConfig(BASE);
    expect(config.port).toBe(8080);
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.routerManagementUrl).toBeNull();
    expect(config.telemetry.sentryDsn).toBeNull();
    expect(config.email.outboxDir).toMatch(/\/data\/email\/$/);
  });

  test("a missing or malformed secret stops startup, naming the variable", () => {
    expect(() => loadConfig({ DATABASE_URL: BASE.DATABASE_URL })).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...BASE, ENCRYPTION_KEY: "short" })).toThrow(/64 hex/);
    expect(() => loadConfig({ ...BASE, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  test("mobile money and SMS are off until set up, and half a set-up is refused", () => {
    expect(loadConfig(BASE).features).toEqual({ mobileMoney: false, sms: false });
    expect(
      loadConfig({ ...BASE, SNIPPE_API_KEY: "key", SNIPPE_WEBHOOK_SECRET: "secret" }).features,
    ).toEqual({ mobileMoney: true, sms: false });
    expect(() => loadConfig({ ...BASE, SNIPPE_API_KEY: "key" })).toThrow(/SNIPPE_WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...BASE, BRIQ_API_KEY: "key" })).toThrow(/BRIQ_SENDER_ID/);
  });

  test("the stand-in providers can never run in production", () => {
    expect(loadConfig({ ...BASE, FAKE_PROVIDERS: "true" }).features.mobileMoney).toBe(true);
    expect(() => loadConfig({ ...BASE, NODE_ENV: "production", FAKE_PROVIDERS: "true" })).toThrow(
      /FAKE_PROVIDERS: refused in production/,
    );
  });

  test("production requires email delivery and the trusted proxies", () => {
    const production = { ...BASE, NODE_ENV: "production" };
    expect(() => loadConfig(production)).toThrow(/RESEND_API_KEY: required in production/);
    expect(() => loadConfig(production)).toThrow(/TRUSTED_PROXIES: required in production/);
    const config = loadConfig({
      ...production,
      RESEND_API_KEY: "re_test",
      R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      R2_BUCKET: "hashifi",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      TRUSTED_PROXIES: "10.0.1.0/24, 10.0.2.5",
    });
    expect(config.auth.trustedProxies).toEqual(["10.0.1.0/24", "10.0.2.5"]);
  });

  test("the tunnel settings go together, and management must be the platform's address", () => {
    const tunnel = {
      ...BASE,
      TUNNEL_NETWORK: "10.88.0.0/16",
      TUNNEL_PLATFORM_PUBLIC_KEY: `${"A".repeat(43)}=`,
      TUNNEL_ENDPOINT: "tunnel.example.com:51820",
    };
    expect(loadConfig(BASE).tunnel).toBeNull();
    expect(() => loadConfig({ ...BASE, TUNNEL_NETWORK: "10.88.0.0/16" })).toThrow(/together/);
    expect(() => loadConfig(tunnel)).toThrow(/platform's tunnel address 10.88.0.1/);
    expect(() => loadConfig({ ...tunnel, ROUTER_MANAGEMENT_URL: "http://10.88.0.9:8080" })).toThrow(
      /10.88.0.1/,
    );
    const config = loadConfig({ ...tunnel, ROUTER_MANAGEMENT_URL: "http://10.88.0.1:8080" });
    expect(config.tunnel).toEqual({
      network: "10.88.0.0/16",
      platformPublicKey: `${"A".repeat(43)}=`,
      endpointHost: "tunnel.example.com",
      endpointPort: 51820,
    });
  });

  test("blank optional values count as unset", () => {
    expect(loadConfig({ ...BASE, PORTAL_ORIGIN: "", PORT: " " }).portalOrigin).toBeNull();
  });
});

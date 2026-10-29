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

  test("production requires email delivery and the trusted proxies", () => {
    const production = { ...BASE, NODE_ENV: "production" };
    expect(() => loadConfig(production)).toThrow(/RESEND_API_KEY: required in production/);
    expect(() => loadConfig(production)).toThrow(/TRUSTED_PROXIES: required in production/);
    const config = loadConfig({
      ...production,
      RESEND_API_KEY: "re_test",
      TRUSTED_PROXIES: "10.0.1.0/24, 10.0.2.5",
    });
    expect(config.auth.trustedProxies).toEqual(["10.0.1.0/24", "10.0.2.5"]);
  });

  test("blank optional values count as unset", () => {
    expect(loadConfig({ ...BASE, PORTAL_ORIGIN: "", PORT: " " }).portalOrigin).toBeNull();
  });
});

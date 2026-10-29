import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.js";

const BASE = {
  DATABASE_URL: "postgresql://hashifi:hashifi@127.0.0.1:5437/hashifi",
  ENCRYPTION_KEY: "ab".repeat(32),
};

describe("loadConfig", () => {
  test("defaults fill everything optional", () => {
    const config = loadConfig(BASE);
    expect(config.port).toBe(8080);
    expect(config.encryptionKey).toHaveLength(32);
    expect(config.routerManagementUrl).toBeNull();
    expect(config.telemetry.sentryDsn).toBeNull();
  });

  test("a missing or malformed secret stops startup, naming the variable", () => {
    expect(() => loadConfig({ DATABASE_URL: BASE.DATABASE_URL })).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...BASE, ENCRYPTION_KEY: "short" })).toThrow(/64 hex/);
    expect(() => loadConfig({ ...BASE, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  test("blank optional values count as unset", () => {
    expect(loadConfig({ ...BASE, PORTAL_ORIGIN: "", PORT: " " }).portalOrigin).toBeNull();
  });
});

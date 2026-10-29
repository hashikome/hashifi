import { describe, expect, test } from "bun:test";
import { redact } from "./redact.js";

describe("redact", () => {
  test("RouterOS parameters with voucher codes and credentials", () => {
    const out = redact(
      "RouterOS rejected /ip/hotspot/user/add =name=SIMRX2PJH =password=SIMRX2PJH",
    );
    expect(out).not.toContain("SIMRX2PJH");
    expect(out).toContain("=name=[redacted]");
  });

  test("RouterOS query filters with voucher codes", () => {
    expect(redact("/ip/hotspot/user/print ?name=SIMRX2PJH")).toBe(
      "/ip/hotspot/user/print ?name=[redacted]",
    );
  });

  test("key=value credentials in console syntax and JSON", () => {
    const out = redact(
      `password="Lab#Pass1" {"code":"WIFI-8K2F"} voucher_code=ABC123 api_key: sk_x`,
    );
    for (const secret of ["Lab#Pass1", "WIFI-8K2F", "ABC123", "sk_x"]) {
      expect(out).not.toContain(secret);
    }
  });

  test("connection strings keep the host but lose the credentials", () => {
    const out = redact("connect failed: postgresql://hashifi:s3cret@db:5432/hashifi");
    expect(out).toBe("connect failed: postgresql://[redacted]@db:5432/hashifi");
  });

  test("personal data: emails, MAC addresses and phone numbers", () => {
    const out = redact(
      "guest admin@example.com on 52:54:00:4A:00:10 / 52-54-00-4a-00-10 paid from +255712345678 or 0712345678",
    );
    expect(out).toBe("guest [email] on [mac] / [mac] paid from [phone] or [phone]");
  });

  test("ordinary operational text is left alone", () => {
    const text = "Router hashifi-sim at 10.88.0.2:8728 timed out after 10s (status 504)";
    expect(redact(text)).toBe(text);
  });
});

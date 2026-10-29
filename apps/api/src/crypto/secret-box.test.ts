import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { SecretBox } from "./secret-box.js";

const box = new SecretBox(randomBytes(32));

describe("SecretBox", () => {
  test("round-trips, including quotes and $ that RouterOS passwords may hold", () => {
    const secret = 'pa$$ "word" ✓';
    expect(box.open(box.seal(secret))).toBe(secret);
  });

  test("each seal is different, so equal secrets are not visible as equal", () => {
    expect(box.seal("same")).not.toBe(box.seal("same"));
  });

  test("a tampered value fails instead of decrypting to garbage", () => {
    const parts = box.seal("router-password").split(":");
    const ct = Buffer.from(parts[3] ?? "", "base64url");
    ct[0] = (ct[0] ?? 0) ^ 1;
    parts[3] = ct.toString("base64url");
    expect(() => box.open(parts.join(":"))).toThrow();
  });

  test("another key cannot open it", () => {
    expect(() => new SecretBox(randomBytes(32)).open(box.seal("x"))).toThrow();
  });

  test("rejects a wrong-sized key and malformed input", () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
    expect(() => box.open("iv:ciphertext")).toThrow(/Not a sealed secret/);
  });
});

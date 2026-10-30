import { describe, expect, test } from "bun:test";
import { CODE_ALPHABET, CODE_LENGTH, generateCode, generateCodes } from "./voucher-codes.js";

describe("voucher codes", () => {
  test("prefix, hyphen, and eight unambiguous upper-case characters", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateCode("WIFI");
      expect(code).toMatch(/^WIFI-[A-HJKMNP-Z2-9]{8}$/);
      expect(code).toBe(code.toUpperCase());
    }
    expect(CODE_ALPHABET).toHaveLength(31);
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(CODE_LENGTH).toBe(8);
  });

  test("every character of the alphabet appears, roughly evenly", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      for (const char of generateCode("X").slice(2)) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(CODE_ALPHABET.length);
    const expected = (4000 * CODE_LENGTH) / CODE_ALPHABET.length;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });

  test("codes already taken are replaced, never repeated", async () => {
    let first = true;
    const codes = await generateCodes("WIFI", 50, async (candidates) => {
      // The first round reports half the candidates as taken.
      if (!first) return new Set();
      first = false;
      return new Set(candidates.slice(0, 25));
    });
    expect(new Set(codes).size).toBe(50);
  });

  test("a store that reports every code taken fails rather than loops", async () => {
    await expect(generateCodes("WIFI", 3, async (c) => new Set(c))).rejects.toThrow(/unique/);
  });
});

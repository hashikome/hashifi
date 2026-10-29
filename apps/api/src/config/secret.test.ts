import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSecret, requireSecret } from "./secret.js";

const dir = mkdtempSync(join(tmpdir(), "hashifi-secret-"));
const file = join(dir, "db");
writeFileSync(file, "postgresql://from-file\n");

describe("readSecret", () => {
  test("a _FILE secret wins over the plain variable, trimmed", () => {
    expect(readSecret("DATABASE_URL", { DATABASE_URL_FILE: file, DATABASE_URL: "plain" })).toBe(
      "postgresql://from-file",
    );
  });

  test("falls back to the plain variable", () => {
    expect(readSecret("DATABASE_URL", { DATABASE_URL: " plain " })).toBe("plain");
  });

  test("is null when neither is set, or the variable is blank", () => {
    expect(readSecret("DATABASE_URL", {})).toBeNull();
    expect(readSecret("DATABASE_URL", { DATABASE_URL: "  " })).toBeNull();
  });

  test("an unreadable _FILE path fails loudly instead of falling back", () => {
    expect(() =>
      readSecret("DATABASE_URL", { DATABASE_URL_FILE: join(dir, "missing"), DATABASE_URL: "x" }),
    ).toThrow();
  });

  test("requireSecret names what to set", () => {
    expect(() => requireSecret("ENCRYPTION_KEY", {})).toThrow(/ENCRYPTION_KEY_FILE/);
  });
});

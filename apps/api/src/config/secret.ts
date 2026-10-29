import { readFileSync } from "node:fs";

/**
 * Reads a secret by the deployment contract (docs/SECURITY.md, Credentials): `<NAME>_FILE`
 * (a Docker secret, e.g. /run/secrets/x) wins, and its trimmed content is the value; a set
 * path that cannot be read fails at startup. Otherwise the plain variable is used. Returns null
 * when neither is set. No password manager is involved.
 */
export function readSecret(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const path = env[`${name}_FILE`];
  if (path) return readFileSync(path, "utf8").trim();
  const value = env[name]?.trim();
  return value ? value : null;
}

/** As `readSecret`, but a missing value is a startup error naming what to set. */
export function requireSecret(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = readSecret(name, env);
  if (value === null) {
    throw new Error(`${name} is required: set ${name}_FILE to a secret file, or ${name}.`);
  }
  return value;
}

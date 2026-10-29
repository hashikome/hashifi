import type { routers } from "../db/schema.js";
import { decrypt } from "../utils/encrypt.js";
import type { RouterCredentials } from "./mikrotik.js";

type RouterRow = typeof routers.$inferSelect;

/** The RouterOS API port used when a router has no management target of its own. */
export const DEFAULT_API_PORT = Number(process.env.MIKROTIK_API_PORT ?? 8728);

/**
 * Where this API reaches a router's RouterOS API.
 *
 * Today that is the router's LAN address on one global port, which only works when the API
 * shares the router's LAN. The adoption plan's router sim (M2) decides the cloud design
 * (a router-initiated tunnel) and M3 gives each router its own management address; this is
 * the one place that changes.
 */
export function managementTarget(router: RouterRow): { host: string; port: number } {
  return { host: router.ipAddress, port: DEFAULT_API_PORT };
}

/**
 * Pull API credentials off a router row, decrypting the stored password.
 * Returns null (with a warning) when the router has no usable credentials —
 * callers are expected to skip rather than throw.
 */
export function getRouterCredentials(
  router: RouterRow,
  scope = "RouterSync",
): RouterCredentials | null {
  if (!router.apiUsername || !router.apiPasswordEncrypted) {
    console.warn(
      `[${scope}] Router "${router.name}" (${router.id}) has no API credentials — skipping`,
    );
    return null;
  }
  try {
    return {
      ...managementTarget(router),
      username: router.apiUsername,
      password: decrypt(router.apiPasswordEncrypted),
    };
  } catch {
    console.warn(`[${scope}] Failed to decrypt credentials for router "${router.name}" — skipping`);
    return null;
  }
}

import type { routers } from "../db/schema.js";
import { decrypt } from "../utils/encrypt.js";
import type { RouterCredentials } from "./mikrotik.js";

type RouterRow = typeof routers.$inferSelect;

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
      host: router.ipAddress,
      username: router.apiUsername,
      password: decrypt(router.apiPasswordEncrypted),
    };
  } catch {
    console.warn(`[${scope}] Failed to decrypt credentials for router "${router.name}" — skipping`);
    return null;
  }
}

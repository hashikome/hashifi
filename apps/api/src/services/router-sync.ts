import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { packages, routers, vouchers } from "../db/schema.js";
import { logSystemEvent } from "../utils/audit.js";
import { withRetry } from "../utils/retry.js";
import {
  type CreateHotspotUserOptions,
  closeConnection,
  connectToRouter,
  createHotspotUser,
  ensureHotspotUserProfile,
  ensureHotspotUserProfileAssigned,
  type HotspotUserCapabilities,
  hotspotUserExists,
  kickHotspotSession,
  type MikroTikConn,
  packageCanThrottle,
  type RouterCredentials,
  rateLimitFor,
  removeHotspotUser,
  throttledProfileNameForPackage,
  throttledRateLimitFor,
  userProfileNameForPackage,
} from "./mikrotik.js";
import { getRouterCredentials } from "./router-credentials.js";

type RouterRow = typeof routers.$inferSelect;
type PackageRow = typeof packages.$inferSelect;

function getCredentials(router: RouterRow): RouterCredentials | null {
  return getRouterCredentials(router, "RouterSync");
}

/** Outcome of pushing to every router in a venue — callers must be able to see failures. */
export interface SyncOutcome {
  attempted: number;
  succeeded: number;
  failures: { router: string; error: string }[];
}

export function outcomeOk(outcome: SyncOutcome): boolean {
  return outcome.succeeded > 0 && outcome.failures.length === 0;
}

export function describeFailures(outcome: SyncOutcome): string {
  return outcome.failures.map((f) => `${f.router}: ${f.error}`).join("; ");
}

function emptyOutcome(): SyncOutcome {
  return { attempted: 0, succeeded: 0, failures: [] };
}

/**
 * Capabilities cached by the probe (services/router-provision/probe.ts).
 * null when the router has never been probed — the caller then stays optimistic.
 */
function capsFor(router: RouterRow): HotspotUserCapabilities | null {
  const caps = router.capabilities as Partial<HotspotUserCapabilities> | null;
  if (typeof caps?.userRateLimit !== "boolean" || typeof caps?.userSharedUsers !== "boolean") {
    return null;
  }
  return { userRateLimit: caps.userRateLimit, userSharedUsers: caps.userSharedUsers };
}

/** Connection-level problems are worth another attempt; rejected commands are not. */
function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("ehostunreach") ||
    msg.includes("socket") ||
    msg.includes("not present in") // read-back failed — the write may land on retry
  );
}

/**
 * Does this router need the limits on a **profile** rather than on each user?
 *
 * `capsFor` returns null when the router has never been probed, and staying optimistic is right
 * there: `createHotspotUser` retries without the rejected params, so the worst case is one wasted
 * round-trip, whereas creating profiles on a board that does not need them is permanent clutter.
 *
 * Either flag being false is enough. A board that takes `rate-limit` but not `shared-users` still
 * needs somewhere to put the device limit, and one profile carrying both is simpler than splitting
 * them — the per-user value wins on any board that accepts it, so sending both is safe.
 */
export function needsProfileLimits(caps: HotspotUserCapabilities | null): boolean {
  if (!caps) return false;
  return !caps.userRateLimit || !caps.userSharedUsers;
}

/**
 * Does this package need a profile on this router?
 *
 * Two reasons, not one:
 *
 *   • the board rejects per-user limits, so the cap has nowhere else to live; or
 *   • the package can be throttled, in which case throttling is a swap between this profile and
 *     its throttled twin — and that has to work on *every* board, including ones that would
 *     happily take a per-user rate-limit. Without the normal profile existing on such a board,
 *     un-throttling would have to send the user back to `default`, which has no cap at all: the
 *     customer would come out of a throttle window *faster* than their package allows.
 */
export function needsProfile(
  pkg: { throttledDownloadMbps: number | null },
  caps: HotspotUserCapabilities | null,
): boolean {
  return needsProfileLimits(caps) || packageCanThrottle(pkg);
}

/**
 * Create the per-package profile(s) this router needs, and return the name to put on the user.
 *
 * Called once per package per connection rather than once per voucher — a batch of 200 codes on one
 * package should cost one profile round-trip, not 200.
 */
async function ensureProfileFor(
  conn: Awaited<ReturnType<typeof connectToRouter>>,
  pkg: PackageRow,
  caps: HotspotUserCapabilities | null,
): Promise<string | null> {
  if (!needsProfile(pkg, caps)) return null;
  const throttleable = packageCanThrottle(pkg);

  const name = userProfileNameForPackage(pkg.id);
  await ensureHotspotUserProfile(conn, {
    name,
    rateLimit: rateLimitFor(pkg),
    sharedUsers: pkg.deviceLimit,
  });

  // Created up front rather than on first throttle: a peak-hour boundary hits every active user at
  // once, and that is the worst moment to discover the profile is missing.
  if (throttleable) {
    await ensureHotspotUserProfile(conn, {
      name: throttledProfileNameForPackage(pkg.id),
      rateLimit: throttledRateLimitFor(pkg),
      sharedUsers: pkg.deviceLimit,
    });
  }

  return name;
}

/**
 * Put an already-present voucher onto the right profile.
 *
 * The push paths skip codes that exist, so a router provisioned before the cap moved onto a
 * per-package profile would keep every one of its vouchers uncapped. Logged rather than silent,
 * because this mutates config a customer may be using right now.
 */
async function repairProfile(
  conn: Awaited<ReturnType<typeof connectToRouter>>,
  code: string,
  profileName: string,
  routerName: string,
  packageId: string,
): Promise<void> {
  // The throttled twin is a legitimate place for a voucher to be sitting — the live monitor may
  // have put it there seconds ago — so a repair must not treat it as damage and yank the customer
  // back to full speed mid-window.
  const throttled = [throttledProfileNameForPackage(packageId)];
  if (await ensureHotspotUserProfileAssigned(conn, code, profileName, throttled)) {
    console.log(
      `[RouterSync] Moved existing voucher "${code}" onto profile "${profileName}" on ` +
        `"${routerName}" — it had no speed cap before.`,
    );
  }
}

function buildUserOpts(
  code: string,
  pkg: PackageRow,
  dataLimitGb: number | null,
  durationMinutes?: number | null,
  profileName?: string | null,
): CreateHotspotUserOptions {
  return {
    code,
    deviceLimit: pkg.deviceLimit,
    downloadSpeedMbps: pkg.downloadSpeedMbps,
    uploadSpeedMbps: pkg.uploadSpeedMbps ?? null,
    dataLimitGb: dataLimitGb ?? pkg.dataLimitGb ?? null,
    durationMinutes: durationMinutes ?? pkg.durationMinutes ?? null,
    profileName: profileName ?? null,
  };
}

/**
 * Push a batch of new voucher codes to every router in a venue.
 * Called fire-and-forget after voucher batch generation.
 */
export async function pushVouchersToVenueRouters(
  venueId: string,
  codes: string[],
  pkg: PackageRow,
  dataLimitGb: number | null,
): Promise<SyncOutcome> {
  if (codes.length === 0) return emptyOutcome();

  const venueRouters = await db.select().from(routers).where(eq(routers.venueId, venueId));

  if (venueRouters.length === 0) {
    const reason = `No routers configured for venue ${venueId}`;
    console.warn(`[RouterSync] ${reason} — vouchers saved to DB but not pushed to any router`);
    return { attempted: 0, succeeded: 0, failures: [{ router: "(none)", error: reason }] };
  }

  const outcome: SyncOutcome = { attempted: 0, succeeded: 0, failures: [] };

  for (const router of venueRouters) {
    const creds = getCredentials(router);
    if (!creds) {
      outcome.failures.push({ router: router.name, error: "No usable API credentials" });
      continue;
    }
    outcome.attempted++;

    try {
      await withRetry(
        async () => {
          let conn: MikroTikConn | null = null;
          try {
            conn = await connectToRouter(creds);
            const caps = capsFor(router);
            // Once for the batch, before any user references it.
            const profileName = await ensureProfileFor(conn, pkg, caps);
            for (const code of codes) {
              if (!(await hotspotUserExists(conn, code))) {
                await createHotspotUser(
                  conn,
                  buildUserOpts(code, pkg, dataLimitGb, null, profileName),
                  caps,
                );
              } else if (profileName) {
                // Already on the router, possibly from before the profile carried the cap.
                await repairProfile(conn, code, profileName, router.name, pkg.id);
              }
            }
          } finally {
            if (conn) await closeConnection(conn);
          }
        },
        {
          // Connection blips are worth retrying; a rejected command is not.
          shouldRetry: (err) => isTransient(err),
          onRetry: (err, attempt, delay) =>
            console.warn(
              `[RouterSync] Push to "${router.name}" failed (attempt ${attempt}) — ` +
                `retrying in ${delay}ms: ${(err as Error).message}`,
            ),
        },
      );

      outcome.succeeded++;
      console.log(
        `[RouterSync] Pushed ${codes.length} vouchers to router "${router.name}" (${router.ipAddress})`,
      );
    } catch (err) {
      const error = (err as Error).message;
      outcome.failures.push({ router: router.name, error });
      console.error(
        `[RouterSync] Failed to push to router "${router.name}" (${router.ipAddress}):`,
        error,
      );
      await logSystemEvent({
        action: "router.push_failed",
        entityType: "router",
        entityId: router.id,
        entityName: router.name,
        details: { host: router.ipAddress, codes: codes.length, error },
      });
    }
  }

  return outcome;
}

/**
 * Sync all active/unused venue vouchers to a single newly-added router.
 * Called fire-and-forget after POST /api/routers.
 */
export async function syncNewRouter(routerId: string): Promise<void> {
  const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1);

  if (!router) return;

  const creds = getCredentials(router);
  if (!creds) return;

  const venueVouchers = await db
    .select({ voucher: vouchers, pkg: packages })
    .from(vouchers)
    .leftJoin(packages, eq(vouchers.packageId, packages.id))
    .where(
      and(
        eq(vouchers.venueId, router.venueId),
        // pending_activation included: those are redeemed vouchers still waiting on a
        // router to confirm them, so a new router must receive them too.
        inArray(vouchers.status, ["unused", "pending_activation", "active"]),
      ),
    );

  if (venueVouchers.length === 0) {
    console.log(
      `[RouterSync] No vouchers to sync for router "${router.name}" — venue has none yet`,
    );
    return;
  }

  let conn: MikroTikConn | null = null;
  try {
    conn = await connectToRouter(creds);
    const caps = capsFor(router);
    // One profile per distinct package, not per voucher — a venue's vouchers usually span a
    // handful of packages and this loop can be hundreds of codes long.
    const profileByPackage = new Map<string, string | null>();
    let synced = 0;
    for (const { voucher, pkg } of venueVouchers) {
      if (!pkg) continue;
      if (!profileByPackage.has(pkg.id)) {
        profileByPackage.set(pkg.id, await ensureProfileFor(conn, pkg, caps));
      }
      const exists = await hotspotUserExists(conn, voucher.code);
      const profileName = profileByPackage.get(pkg.id) ?? null;
      if (exists && profileName) {
        await repairProfile(conn, voucher.code, profileName, router.name, pkg.id);
      }
      if (!exists) {
        await createHotspotUser(
          conn,
          buildUserOpts(
            voucher.code,
            pkg,
            voucher.dataLimitGb ?? null,
            voucher.durationMinutes ?? null,
            profileName,
          ),
          // Was omitted entirely, so this path always paid the rejected-parameter round-trip on a
          // board whose capabilities we had already measured.
          caps,
        );
        synced++;
      }
    }
    await db
      .update(routers)
      .set({ status: "online", lastSeenAt: new Date() })
      .where(eq(routers.id, routerId));
    console.log(`[RouterSync] Synced ${synced} vouchers to router "${router.name}"`);
  } catch (err) {
    const error = (err as Error).message;
    console.error(
      `[RouterSync] Sync failed for router "${router.name}" (${router.ipAddress}):`,
      error,
    );
    await db.update(routers).set({ status: "error" }).where(eq(routers.id, routerId));
    await logSystemEvent({
      action: "router.sync_failed",
      entityType: "router",
      entityId: routerId,
      entityName: router.name,
      details: { host: router.ipAddress, error },
    });
  } finally {
    if (conn) await closeConnection(conn);
  }
}

/**
 * Ensure a voucher's hotspot user exists on every router in the venue.
 * Called just-in-time from validate-voucher as a safety net for vouchers
 * that were never pushed to MikroTik (e.g., RouterSync failed at batch time).
 * No-ops silently if the user already exists on a given router.
 */
export async function ensureVoucherOnVenueRouters(
  venueId: string,
  code: string,
): Promise<SyncOutcome> {
  const venueRouters = await db.select().from(routers).where(eq(routers.venueId, venueId));
  if (venueRouters.length === 0) {
    return {
      attempted: 0,
      succeeded: 0,
      failures: [{ router: "(none)", error: `No routers configured for venue ${venueId}` }],
    };
  }

  const [row] = await db
    .select({ voucher: vouchers, pkg: packages })
    .from(vouchers)
    .leftJoin(packages, eq(vouchers.packageId, packages.id))
    .where(eq(vouchers.code, code))
    .limit(1);

  if (!row?.pkg) {
    return {
      attempted: 0,
      succeeded: 0,
      failures: [{ router: "(none)", error: `Voucher ${code} has no package` }],
    };
  }
  const pkg = row.pkg;

  const outcome: SyncOutcome = { attempted: 0, succeeded: 0, failures: [] };

  for (const router of venueRouters) {
    const creds = getCredentials(router);
    if (!creds) {
      outcome.failures.push({ router: router.name, error: "No usable API credentials" });
      continue;
    }
    outcome.attempted++;

    try {
      await withRetry(
        async () => {
          let conn: MikroTikConn | null = null;
          try {
            conn = await connectToRouter(creds);
            if (!(await hotspotUserExists(conn, code))) {
              const caps = capsFor(router);
              await createHotspotUser(
                conn,
                buildUserOpts(
                  code,
                  pkg,
                  row.voucher.dataLimitGb ?? null,
                  row.voucher.durationMinutes ?? null,
                  await ensureProfileFor(conn, pkg, caps),
                ),
                caps,
              );
              console.log(
                `[RouterSync] JIT: created hotspot user "${code}" on router "${router.name}"`,
              );
            }
          } finally {
            if (conn) await closeConnection(conn);
          }
        },
        {
          attempts: 2, // a user is waiting on this request — don't stall them
          backoffMs: [400],
          shouldRetry: (err) => isTransient(err),
        },
      );
      outcome.succeeded++;
    } catch (err) {
      const error = (err as Error).message;
      outcome.failures.push({ router: router.name, error });
      console.warn(`[RouterSync] JIT sync failed for "${code}" on router "${router.name}":`, error);
      await logSystemEvent({
        action: "router.jit_sync_failed",
        entityType: "router",
        entityId: router.id,
        entityName: router.name,
        details: { host: router.ipAddress, voucherCode: code, error },
      });
    }
  }

  return outcome;
}

/**
 * Kick an active hotspot session without removing the user account.
 * Called fire-and-forget when an admin terminates a session.
 */
export async function kickVoucherFromVenueRouters(venueId: string, code: string): Promise<void> {
  const venueRouters = await db.select().from(routers).where(eq(routers.venueId, venueId));
  if (venueRouters.length === 0) return;

  for (const router of venueRouters) {
    const creds = getCredentials(router);
    if (!creds) continue;
    let conn: MikroTikConn | null = null;
    try {
      conn = await connectToRouter(creds);
      await kickHotspotSession(conn, code);
    } catch {
      // best-effort
    } finally {
      if (conn) await closeConnection(conn);
    }
  }
}

/**
 * Remove a single voucher's hotspot user from every router in a venue.
 * Called fire-and-forget after DELETE /api/vouchers/:id.
 */
export async function removeVoucherFromVenueRouters(venueId: string, code: string): Promise<void> {
  await removeVouchersFromVenueRouters(venueId, [code]);
}

/**
 * Remove multiple voucher hotspot users from every router in a venue.
 * Connects once per router and removes all codes in one session.
 * Called fire-and-forget after DELETE /api/vouchers/batch.
 */
export async function removeVouchersFromVenueRouters(
  venueId: string,
  codes: string[],
): Promise<void> {
  if (codes.length === 0) return;

  const venueRouters = await db.select().from(routers).where(eq(routers.venueId, venueId));

  if (venueRouters.length === 0) return;

  for (const router of venueRouters) {
    const creds = getCredentials(router);
    if (!creds) continue;

    let conn: MikroTikConn | null = null;
    try {
      conn = await connectToRouter(creds);
      for (const code of codes) {
        await kickHotspotSession(conn, code).catch(() => {});
        await removeHotspotUser(conn, code);
      }
      console.log(`[RouterSync] Removed ${codes.length} voucher(s) from router "${router.name}"`);
    } catch (err) {
      console.error(
        `[RouterSync] Failed to remove from router "${router.name}" (${router.ipAddress}):`,
        (err as Error).message,
      );
    } finally {
      if (conn) await closeConnection(conn);
    }
  }
}

import { getLogger } from "@logtape/logtape";
import type { AuditLog } from "../audit/audit-log.js";
import type { Package, PrismaClient, Router } from "../generated/prisma/client.js";
import { enrichWideEvent } from "../observability/wide-event.js";
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
  rateLimitFor,
  removeHotspotUser,
  throttledProfileNameForPackage,
  throttledRateLimitFor,
  userProfileNameForPackage,
} from "./mikrotik.js";
import type { RouterAccess } from "./router-credentials.js";

// Voucher codes are credentials: they appear in no log line, only counts do.
const logger = getLogger(["hashifi", "router-sync"]);

/** Statuses whose vouchers must exist on the venue's routers. pending_activation: redeemed, still
 * waiting on a router to confirm, so a new router must receive them too. */
const LIVE_STATUSES = ["unused", "pending_activation", "active"] as const;

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
export function capsFor(router: Router): HotspotUserCapabilities | null {
  const caps = router.capabilities;
  if (caps === null || typeof caps !== "object" || Array.isArray(caps)) return null;
  const { userRateLimit, userSharedUsers } = caps;
  if (typeof userRateLimit !== "boolean" || typeof userSharedUsers !== "boolean") return null;
  return { userRateLimit, userSharedUsers };
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
  pkg: Package,
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
    logger.info(
      "Moved an existing voucher onto profile {profileName} on {routerName}; it had no speed cap before",
      {
        profileName,
        routerName,
      },
    );
  }
}

function buildUserOpts(
  code: string,
  pkg: Package,
  dataLimitGb: number | null,
  durationMinutes: number | null,
  profileName: string | null,
): CreateHotspotUserOptions {
  return {
    code,
    deviceLimit: pkg.deviceLimit,
    downloadSpeedMbps: pkg.downloadSpeedMbps,
    uploadSpeedMbps: pkg.uploadSpeedMbps ?? null,
    dataLimitGb: dataLimitGb ?? pkg.dataLimitGb ?? null,
    durationMinutes: durationMinutes ?? pkg.durationMinutes,
    profileName,
  };
}

/** Keeps a venue's routers holding exactly the vouchers it sells (RouterOS hotspot users). */
export class RouterSync {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: RouterAccess,
    private readonly audit: AuditLog,
  ) {}

  /** Pushes new voucher codes to every router in a venue. */
  async pushVouchers(
    venueId: string,
    codes: string[],
    pkg: Package,
    dataLimitGb: number | null,
  ): Promise<SyncOutcome> {
    if (codes.length === 0) return emptyOutcome();
    const venueRouters = await this.db.router.findMany({ where: { venueId } });
    if (venueRouters.length === 0) {
      const reason = `No routers configured for venue ${venueId}`;
      logger.warn("{reason}: vouchers are saved but on no router", { reason });
      return { attempted: 0, succeeded: 0, failures: [{ router: "(none)", error: reason }] };
    }

    const outcome = emptyOutcome();
    for (const router of venueRouters) {
      const creds = this.access.credentials(router);
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
              logger.warn("Push to {router} failed (attempt {attempt}); retrying in {delay} ms", {
                router: router.name,
                attempt,
                delay,
                error: err instanceof Error ? err.message : String(err),
              }),
          },
        );
        outcome.succeeded++;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        outcome.failures.push({ router: router.name, error });
        await this.audit.system(
          "router.push_failed",
          { type: "router", id: router.id, name: router.name },
          { host: router.ipAddress, codes: codes.length, error },
        );
      }
    }
    enrichWideEvent({ "sync.attempted": outcome.attempted, "sync.succeeded": outcome.succeeded });
    return outcome;
  }

  /** Puts every live voucher of the router's venue on a newly added or re-provisioned router. */
  async syncRouter(routerId: string): Promise<void> {
    const router = await this.db.router.findUnique({ where: { id: routerId } });
    if (!router) return;
    const creds = this.access.credentials(router);
    if (!creds) return;

    const venueVouchers = await this.db.voucher.findMany({
      where: { venueId: router.venueId, status: { in: [...LIVE_STATUSES] } },
      include: { package: true },
    });
    if (venueVouchers.length === 0) return;

    let conn: MikroTikConn | null = null;
    try {
      conn = await connectToRouter(creds);
      const caps = capsFor(router);
      // One profile per distinct package, not per voucher: a venue's vouchers usually span a
      // handful of packages and this loop can be hundreds of codes long.
      const profileByPackage = new Map<string, string | null>();
      let synced = 0;
      for (const voucher of venueVouchers) {
        const pkg = voucher.package;
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
              voucher.dataLimitGb,
              voucher.durationMinutes,
              profileName,
            ),
            caps,
          );
          synced++;
        }
      }
      await this.db.router.update({
        where: { id: routerId },
        data: { status: "online", lastSeenAt: new Date() },
      });
      enrichWideEvent({ "sync.attempted": venueVouchers.length, "sync.succeeded": synced });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.db.router.update({ where: { id: routerId }, data: { status: "error" } });
      await this.audit.system(
        "router.sync_failed",
        { type: "router", id: routerId, name: router.name },
        { host: router.ipAddress, error },
      );
    } finally {
      if (conn) await closeConnection(conn);
    }
  }

  /**
   * Makes sure one voucher exists on every router in its venue: the just-in-time safety net when
   * a guest redeems a voucher that was never pushed (a router was unreachable at batch time).
   */
  async ensureVoucher(venueId: string, code: string): Promise<SyncOutcome> {
    const venueRouters = await this.db.router.findMany({ where: { venueId } });
    if (venueRouters.length === 0) {
      return {
        attempted: 0,
        succeeded: 0,
        failures: [{ router: "(none)", error: `No routers configured for venue ${venueId}` }],
      };
    }
    const voucher = await this.db.voucher.findUnique({
      where: { code },
      include: { package: true },
    });
    const pkg = voucher?.package ?? null;
    if (!voucher || !pkg) {
      return {
        attempted: 0,
        succeeded: 0,
        failures: [{ router: "(none)", error: "The voucher has no package" }],
      };
    }

    const outcome = emptyOutcome();
    for (const router of venueRouters) {
      const creds = this.access.credentials(router);
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
                    voucher.dataLimitGb,
                    voucher.durationMinutes,
                    await ensureProfileFor(conn, pkg, caps),
                  ),
                  caps,
                );
              }
            } finally {
              if (conn) await closeConnection(conn);
            }
          },
          {
            attempts: 2, // a guest is waiting on this request: do not stall them
            backoffMs: [400],
            shouldRetry: (err) => isTransient(err),
          },
        );
        outcome.succeeded++;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        outcome.failures.push({ router: router.name, error });
        await this.audit.system(
          "router.jit_sync_failed",
          { type: "router", id: router.id, name: router.name },
          { host: router.ipAddress, voucherId: voucher.id, error },
        );
      }
    }
    return outcome;
  }

  /** Ends a voucher's active hotspot session without removing it. Best effort. */
  async kickVoucher(venueId: string, code: string): Promise<void> {
    for (const router of await this.db.router.findMany({ where: { venueId } })) {
      const creds = this.access.credentials(router);
      if (!creds) continue;
      let conn: MikroTikConn | null = null;
      try {
        conn = await connectToRouter(creds);
        await kickHotspotSession(conn, code);
      } catch {
        // Best effort: the session ends at its limit anyway.
      } finally {
        if (conn) await closeConnection(conn);
      }
    }
  }

  /** Removes vouchers from every router in a venue, one connection per router. */
  async removeVouchers(venueId: string, codes: string[]): Promise<void> {
    if (codes.length === 0) return;
    for (const router of await this.db.router.findMany({ where: { venueId } })) {
      const creds = this.access.credentials(router);
      if (!creds) continue;
      let conn: MikroTikConn | null = null;
      try {
        conn = await connectToRouter(creds);
        for (const code of codes) {
          await kickHotspotSession(conn, code).catch(() => {});
          await removeHotspotUser(conn, code);
        }
      } catch (err) {
        logger.error("Failed to remove {count} voucher(s) from {router}", {
          count: codes.length,
          router: router.name,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (conn) await closeConnection(conn);
      }
    }
  }
}

import { getLogger } from "@logtape/logtape";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  closeConnection,
  connectToRouter,
  ensureHotspotUserProfileAssigned,
  getActiveClients,
  getSystemUptimeSeconds,
  kickHotspotSession,
  type MikroTikActiveClient,
  type MikroTikConn,
  throttledProfileNameForPackage,
  userProfileNameForPackage,
} from "./mikrotik.js";
import type { RouterAccess } from "./router-credentials.js";

// Voucher codes are credentials: logs name the session or router, never the code.
const logger = getLogger(["hashifi", "live-monitor"]);

export const POLL_INTERVAL_MS = 5_000;
export const HEALTH_CHECK_INTERVAL_MS = 60_000;
/**
 * With nobody watching the live view there is no console to feed, but session status still has
 * to be reconciled (the Users page reads it as "online now"), so poll every Nth tick instead of
 * skipping, and a walked-away device stops reading as connected within 30 s.
 */
export const IDLE_POLL_EVERY_N_TICKS = 6;
const THROTTLE_RETRY_MS = 10 * 60_000;

/** One router's live clients, for the admin live view. */
export interface HotspotUpdate {
  type: "hotspot_update";
  routerId: string;
  routerName: string;
  venueId: string;
  venueName: string;
  timestamp: string;
  clients: MikroTikActiveClient[];
}

export function isPeakHour(start: number | null, end: number | null, eatHour: number): boolean {
  if (start === null || end === null) return false;
  if (start <= end) return eatHour >= start && eatHour < end;
  // Wraps past midnight (e.g. 22 to 06).
  return eatHour >= start || eatHour < end;
}

/** Tanzania is UTC+3 all year (no daylight saving). */
function eatHourOf(date: Date): number {
  return (date.getUTCHours() + 3) % 24;
}

/**
 * Polls online routers for their live hotspot clients: records traffic and router health,
 * closes sessions that left, and applies package throttling. Recovers routers that went offline.
 */
export class LiveMonitor {
  /**
   * Sessions whose last throttle attempt failed, and when to next try them.
   *
   * The old code updated `isThrottled` *inside* the try, after the router write. A rejected write
   * therefore left the flag unchanged, `shouldThrottle === session.isThrottled` stayed false, and the
   * same failing command went back out on **every poll** — every 5s per client, forever. On a 32MB
   * smips board that is real CPU. Keyed by session so one bad package cannot stall the rest.
   */
  private readonly throttleBackoff = new Map<string, number>();

  constructor(
    private readonly db: PrismaClient,
    private readonly access: RouterAccess,
  ) {}

  /** Polls every online router once. `onUpdate` receives each router's live clients. */
  async pollOnce(onUpdate: (update: HotspotUpdate) => void = () => {}): Promise<void> {
    const onlineRouters = await this.db.router.findMany({
      where: { status: "online" },
      include: { venue: { select: { name: true } } },
    });
    if (onlineRouters.length === 0) return;

    const activeByVenue = new Map<string, Set<string>>();
    for (const router of onlineRouters) activeByVenue.set(router.venueId, new Set());
    const eatHour = eatHourOf(new Date());

    await Promise.allSettled(
      onlineRouters.map(async (router) => {
        const creds = this.access.credentials(router);
        if (!creds) return;
        let conn: MikroTikConn | null = null;
        try {
          conn = await connectToRouter(creds);
          const [clients, uptimeSeconds] = await Promise.all([
            getActiveClients(conn),
            getSystemUptimeSeconds(conn),
          ]);
          const venueSet = activeByVenue.get(router.venueId) ?? new Set<string>();
          activeByVenue.set(router.venueId, venueSet);
          for (const client of clients) if (client.user) venueSet.add(client.user);

          onUpdate({
            type: "hotspot_update",
            routerId: router.id,
            routerName: router.name,
            venueId: router.venueId,
            venueName: router.venue.name,
            timestamp: new Date().toISOString(),
            clients,
          });

          await this.db.router.update({
            where: { id: router.id },
            data: { lastSeenAt: new Date(), connectedDevices: clients.length, uptimeSeconds },
          });

          // Traffic counters from the router back onto the sessions.
          const codes = clients.map((c) => c.user).filter((code) => code !== "");
          if (codes.length > 0) {
            const sessions = await this.db.wifiSession.findMany({
              where: {
                venueId: router.venueId,
                status: "connected",
                voucher: { code: { in: codes } },
              },
              select: { id: true, voucher: { select: { code: true } } },
            });
            const sessionByCode = new Map(
              sessions.flatMap((s) => (s.voucher ? [[s.voucher.code, s.id] as const] : [])),
            );
            await Promise.allSettled(
              clients.flatMap((client) => {
                const sessionId = sessionByCode.get(client.user);
                if (sessionId === undefined) return [];
                return [
                  this.db.wifiSession.update({
                    where: { id: sessionId },
                    data: {
                      uploadBytes: BigInt(client.bytesIn),
                      downloadBytes: BigInt(client.bytesOut),
                    },
                  }),
                ];
              }),
            );
          }

          await this.applyThrottle(conn, router.id, clients, eatHour);
        } catch (err) {
          logger.error("Poll failed for router {router}", {
            router: router.name,
            routerId: router.id,
            error: err instanceof Error ? err.message : String(err),
          });
          await this.db.router.update({
            where: { id: router.id },
            data: { status: "error", connectedDevices: 0 },
          });
        } finally {
          if (conn) await closeConnection(conn);
        }
      }),
    );

    // Sessions the routers no longer report have ended.
    const now = new Date();
    for (const [venueId, activeCodes] of activeByVenue) {
      const connected = await this.db.wifiSession.findMany({
        where: { venueId, status: "connected" },
        select: { id: true, voucher: { select: { code: true } } },
      });
      const gone = connected
        .filter((s) => !s.voucher || !activeCodes.has(s.voucher.code))
        .map((s) => s.id);
      if (gone.length > 0) {
        await this.db.wifiSession.updateMany({
          where: { id: { in: gone } },
          data: { status: "disconnected", endedAt: now },
        });
      }
    }
  }

  /** Tries to reach routers marked offline or in error, and marks those that answer online. */
  async healthCheck(): Promise<void> {
    const deadRouters = await this.db.router.findMany({
      where: { status: { in: ["offline", "error"] } },
    });
    await Promise.allSettled(
      deadRouters.map(async (router) => {
        const creds = this.access.credentials(router);
        if (!creds) return;
        let conn: MikroTikConn | null = null;
        try {
          conn = await connectToRouter(creds);
          await this.db.router.update({
            where: { id: router.id },
            data: { status: "online", lastSeenAt: new Date() },
          });
          logger.info("Router {router} recovered and is online", { router: router.name });
        } catch {
          // Still unreachable: its status stays as it is.
        } finally {
          if (conn) await closeConnection(conn);
        }
      }),
    );
  }

  /**
   * For each active MikroTik client on this router, evaluate whether throttling should apply (peak
   * hours or data threshold) and move the voucher between its normal and throttled profile when the
   * state changes.
   *
   * **Why a profile swap and not `rate-limit` on the user.** The hAP lite (smips, 7.23.2) rejects
   * `rate-limit` on `/ip hotspot user` — `unknown parameter` — which is exactly what this used to
   * send, so on that board throttling could never take effect and simply retried forever. Profiles
   * accept `rate-limit` on every board measured, so the swap is the one mechanism that works
   * everywhere. `router-sync` creates both profiles for any package that can be throttled.
   */
  private async applyThrottle(
    conn: MikroTikConn,
    routerId: string,
    clients: MikroTikActiveClient[],
    eatHour: number,
  ): Promise<void> {
    const codes = clients.map((c) => c.user).filter((code) => code !== "");
    if (codes.length === 0) return;

    const sessions = await this.db.wifiSession.findMany({
      where: { status: "connected", routerId, voucher: { code: { in: codes } } },
      select: {
        id: true,
        isThrottled: true,
        voucher: { select: { code: true } },
        package: {
          select: {
            id: true,
            throttledDownloadMbps: true,
            peakStartHour: true,
            peakEndHour: true,
            throttleAfterGb: true,
          },
        },
      },
    });
    if (sessions.length === 0) return;
    const sessionByCode = new Map(
      sessions.flatMap((s) => (s.voucher ? [[s.voucher.code, s] as const] : [])),
    );

    const now = Date.now();
    // A session that fails and then disconnects never clears its own entry, and this process
    // runs for weeks, so expired entries are dropped each pass.
    for (const [sessionId, retryAt] of this.throttleBackoff) {
      if (retryAt <= now) this.throttleBackoff.delete(sessionId);
    }

    for (const client of clients) {
      const session = sessionByCode.get(client.user);
      const pkg = session?.package ?? null;
      // No throttle configured for this package.
      if (!session || !pkg || pkg.throttledDownloadMbps === null) continue;

      const bytesUsed = client.bytesIn + client.bytesOut;
      const isPeak = isPeakHour(pkg.peakStartHour, pkg.peakEndHour, eatHour);
      const isOverData =
        pkg.throttleAfterGb !== null && bytesUsed >= pkg.throttleAfterGb * 1_073_741_824;
      const shouldThrottle = isPeak || isOverData;

      if (shouldThrottle === session.isThrottled) {
        this.throttleBackoff.delete(session.id);
        continue;
      }
      const retryAt = this.throttleBackoff.get(session.id);
      if (retryAt !== undefined && now < retryAt) continue;

      const profileName = shouldThrottle
        ? throttledProfileNameForPackage(pkg.id)
        : userProfileNameForPackage(pkg.id);

      try {
        const moved = await ensureHotspotUserProfileAssigned(conn, client.user, profileName);
        /*
         * The swap alone governs the *next* login: RouterOS builds a hotspot session's dynamic
         * queue when the user authenticates, so a running session keeps the limit it started
         * with. Dropping the session puts the new speed in force now, and the portal's reconnect
         * logs a device with a live voucher straight back in.
         *
         * `moved` stops this becoming a kick loop, and it is load-bearing: the reconnect opens a
         * new session row with isThrottled at its false default, so the next poll sees a mismatch
         * again; the router is already on the target profile, so `moved` is false, nothing is
         * kicked, and the flag is corrected. Kick unconditionally and the guest is dropped every
         * five seconds for as long as the throttle window lasts.
         */
        if (moved) await kickHotspotSession(conn, client.user);
        this.throttleBackoff.delete(session.id);
        logger.info("{change} session {sessionId} onto profile {profileName}", {
          change: shouldThrottle ? "Throttled" : "Unthrottled",
          sessionId: session.id,
          profileName,
        });
      } catch (err) {
        // Latch the failure: retrying a rejected command every 5 s pinned the CPU on an hAP lite.
        // The database stays honest, because the flag is written only after the router agreed.
        this.throttleBackoff.set(session.id, now + THROTTLE_RETRY_MS);
        logger.error("Could not move session {sessionId} onto {profileName}; retrying later", {
          sessionId: session.id,
          profileName,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      // Outside the try on purpose: the flag records what the router did, not what we intended.
      await this.db.wifiSession.update({
        where: { id: session.id },
        data: { isThrottled: shouldThrottle },
      });
    }
  }
}

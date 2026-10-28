import { and, eq, inArray, or } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "../db/index.js";
import { packages, routers, venues, vouchers, wifiSessions } from "../db/schema.js";
import { decrypt } from "../utils/encrypt.js";
import {
  closeConnection,
  connectToRouter,
  ensureHotspotUserProfileAssigned,
  getActiveClients,
  getSystemUptimeSeconds,
  kickHotspotSession,
  type MikroTikConn,
  throttledProfileNameForPackage,
  userProfileNameForPackage,
} from "./mikrotik.js";

const POLL_INTERVAL_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
// With nobody watching /ws/live there is no console to feed, but session status still
// has to be reconciled — the Users page reads it as "online now". Poll every Nth tick
// instead of skipping, so a walked-away device stops reading as connected within 30s.
const IDLE_POLL_EVERY_N_TICKS = 6;

function isPeakHour(start: number | null, end: number | null, eatHour: number): boolean {
  if (start == null || end == null) return false;
  if (start <= end) return eatHour >= start && eatHour < end;
  // wrap-around midnight (e.g. 22-06)
  return eatHour >= start || eatHour < end;
}

export function startLiveMonitor(wss: WebSocketServer): void {
  const broadcast = (data: unknown) => {
    const payload = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  // ── Fast poll: query active clients from known-online routers ──────────────
  const pollOnce = async () => {
    const onlineRouters = await db
      .select({ router: routers, venueName: venues.name })
      .from(routers)
      .leftJoin(venues, eq(routers.venueId, venues.id))
      .where(eq(routers.status, "online"));

    if (onlineRouters.length === 0) return;

    // Pre-init per-venue active code sets (avoids Map race in parallel callbacks)
    const activeByVenue = new Map<string, Set<string>>();
    for (const { router } of onlineRouters) {
      if (router.venueId && !activeByVenue.has(router.venueId)) {
        activeByVenue.set(router.venueId, new Set());
      }
    }

    // Tanzania EAT = UTC+3 — compute once per poll cycle
    const nowUtc = new Date();
    const eatHour = (nowUtc.getUTCHours() + 3) % 24;

    await Promise.allSettled(
      onlineRouters.map(async ({ router, venueName }) => {
        if (!router.apiUsername || !router.apiPasswordEncrypted) return;

        let conn: MikroTikConn | null = null;
        try {
          conn = await connectToRouter({
            host: router.ipAddress,
            username: router.apiUsername,
            password: decrypt(router.apiPasswordEncrypted),
          });

          const [clients, uptimeSeconds] = await Promise.all([
            getActiveClients(conn),
            getSystemUptimeSeconds(conn),
          ]);

          // Accumulate active voucher codes for reconciliation
          if (router.venueId) {
            const venueSet = activeByVenue.get(router.venueId) ?? new Set<string>();
            activeByVenue.set(router.venueId, venueSet);
            clients.forEach((c) => {
              if (c.user) venueSet.add(c.user);
            });
          }

          broadcast({
            type: "hotspot_update",
            routerId: router.id,
            routerName: router.name,
            venueId: router.venueId,
            venueName: venueName ?? null,
            timestamp: new Date().toISOString(),
            clients,
          });

          await db
            .update(routers)
            .set({ lastSeenAt: new Date(), connectedDevices: clients.length, uptimeSeconds })
            .where(eq(routers.id, router.id));

          // ── Sync bytes from MikroTik back to wifiSessions ─────────────────
          if (clients.length > 0 && router.venueId) {
            const clientCodes = clients.map((c) => c.user).filter(Boolean);
            if (clientCodes.length > 0) {
              const sessionRows = await db
                .select({ id: wifiSessions.id, code: vouchers.code })
                .from(wifiSessions)
                .innerJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
                .where(
                  and(
                    eq(wifiSessions.venueId, router.venueId),
                    eq(wifiSessions.status, "connected"),
                    inArray(vouchers.code, clientCodes),
                  ),
                );

              const codeToSession = new Map(sessionRows.map((r) => [r.code, r.id]));
              await Promise.allSettled(
                clients.flatMap((c) => {
                  const sessionId = codeToSession.get(c.user);
                  if (sessionId === undefined) return [];
                  return [
                    db
                      .update(wifiSessions)
                      .set({ uploadBytes: c.bytesIn, downloadBytes: c.bytesOut })
                      .where(eq(wifiSessions.id, sessionId)),
                  ];
                }),
              );
            }
          }

          // ── Throttle check ────────────────────────────────────────────────
          await applyThrottle(conn, router.id, clients, eatHour);
        } catch (err) {
          console.error(
            `[LiveMonitor] Poll failed for router "${router.name}" (${router.ipAddress}):`,
            (err as Error).message,
          );
          await db
            .update(routers)
            .set({ status: "error", connectedDevices: 0 })
            .where(eq(routers.id, router.id));
        } finally {
          if (conn) await closeConnection(conn);
        }
      }),
    );

    // Mark DB sessions as disconnected when they no longer appear in MikroTik
    const now = new Date();
    for (const [venueId, activeCodes] of activeByVenue) {
      const connected = await db
        .select({ id: wifiSessions.id, code: vouchers.code })
        .from(wifiSessions)
        .innerJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
        .where(and(eq(wifiSessions.venueId, venueId), eq(wifiSessions.status, "connected")));

      const toDisconnect = connected.filter((s) => !activeCodes.has(s.code)).map((s) => s.id);

      if (toDisconnect.length > 0) {
        await db
          .update(wifiSessions)
          .set({ status: "disconnected", endedAt: now })
          .where(inArray(wifiSessions.id, toDisconnect));
      }
    }
  };

  // ── Slow health check: try to recover offline/error routers ───────────────
  const healthCheck = async () => {
    const deadRouters = await db
      .select({ router: routers })
      .from(routers)
      .where(or(eq(routers.status, "offline"), eq(routers.status, "error")));

    if (deadRouters.length === 0) return;

    await Promise.allSettled(
      deadRouters.map(async ({ router }) => {
        if (!router.apiUsername || !router.apiPasswordEncrypted) return;

        let conn: MikroTikConn | null = null;
        try {
          conn = await connectToRouter({
            host: router.ipAddress,
            username: router.apiUsername,
            password: decrypt(router.apiPasswordEncrypted),
          });
          // If we get here the router is reachable again
          await db
            .update(routers)
            .set({ status: "online", lastSeenAt: new Date() })
            .where(eq(routers.id, router.id));
          console.log(`[LiveMonitor] Router "${router.name}" recovered — marked online`);
        } catch {
          // Still unreachable — leave status unchanged
        } finally {
          if (conn) await closeConnection(conn);
        }
      }),
    );
  };

  let tick = 0;
  const pollInterval = setInterval(() => {
    tick++;
    if (wss.clients.size === 0 && tick % IDLE_POLL_EVERY_N_TICKS !== 0) return;
    pollOnce().catch((err) => console.error("[LiveMonitor] Unhandled poll error:", err));
  }, POLL_INTERVAL_MS);

  const healthInterval = setInterval(() => {
    healthCheck().catch((err) => console.error("[LiveMonitor] Health check error:", err));
  }, HEALTH_CHECK_INTERVAL_MS);

  if (pollInterval.unref) pollInterval.unref();
  if (healthInterval.unref) healthInterval.unref();

  // Probe dead routers immediately on startup rather than waiting 60s
  healthCheck().catch((err) => console.error("[LiveMonitor] Initial health check error:", err));

  console.log(
    `[LiveMonitor] Started — polling every ${POLL_INTERVAL_MS / 1000}s, ` +
      `health check every ${HEALTH_CHECK_INTERVAL_MS / 1000}s`,
  );
}

/**
 * Sessions whose last throttle attempt failed, and when to next try them.
 *
 * The old code updated `isThrottled` *inside* the try, after the router write. A rejected write
 * therefore left the flag unchanged, `shouldThrottle === session.isThrottled` stayed false, and the
 * same failing command went back out on **every poll** — every 5s per client, forever. On a 32MB
 * smips board that is real CPU. Keyed by session so one bad package cannot stall the rest.
 */
const throttleBackoff = new Map<string, number>();
const THROTTLE_RETRY_MS = 10 * 60_000;

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
async function applyThrottle(
  conn: Awaited<ReturnType<typeof connectToRouter>>,
  routerId: string,
  clients: Awaited<ReturnType<typeof getActiveClients>>,
  eatHour: number,
): Promise<void> {
  if (clients.length === 0) return;

  const clientCodes = clients.map((c) => c.user).filter(Boolean);
  if (clientCodes.length === 0) return;

  const sessionRows = await db
    .select({
      sessionId: wifiSessions.id,
      isThrottled: wifiSessions.isThrottled,
      voucherCode: vouchers.code,
      packageId: packages.id,
      throttledDownload: packages.throttledDownloadMbps,
      throttledUpload: packages.throttledUploadMbps,
      peakStart: packages.peakStartHour,
      peakEnd: packages.peakEndHour,
      throttleAfterGb: packages.throttleAfterGb,
      normalDownload: packages.downloadSpeedMbps,
      normalUpload: packages.uploadSpeedMbps,
    })
    .from(wifiSessions)
    .innerJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
    .innerJoin(packages, eq(wifiSessions.packageId, packages.id))
    .where(
      and(
        eq(wifiSessions.status, "connected"),
        eq(wifiSessions.routerId, routerId),
        inArray(vouchers.code, clientCodes),
      ),
    );

  if (sessionRows.length === 0) return;

  const sessionByCode = new Map(sessionRows.map((r) => [r.voucherCode, r]));

  const now = Date.now();

  // A session that fails and then disconnects never comes back to clear its own entry, and this
  // process runs for weeks. Entries are only meaningful until they expire, so drop the expired
  // ones each pass rather than letting the map accumulate one row per session forever.
  for (const [sessionId, retryAt] of throttleBackoff) {
    if (retryAt <= now) throttleBackoff.delete(sessionId);
  }

  for (const client of clients) {
    const session = sessionByCode.get(client.user);
    // Skip if no throttle configured for this package
    if (!session || session.throttledDownload == null) continue;

    const bytesUsed = client.bytesIn + client.bytesOut;
    const isPeak = isPeakHour(session.peakStart, session.peakEnd, eatHour);
    const isOverData =
      session.throttleAfterGb != null && bytesUsed >= session.throttleAfterGb * 1_073_741_824;
    const shouldThrottle = isPeak || isOverData;

    if (shouldThrottle === session.isThrottled) {
      throttleBackoff.delete(session.sessionId);
      continue;
    }

    const retryAt = throttleBackoff.get(session.sessionId);
    if (retryAt !== undefined && now < retryAt) continue;

    const profileName = shouldThrottle
      ? throttledProfileNameForPackage(session.packageId)
      : userProfileNameForPackage(session.packageId);

    try {
      const moved = await ensureHotspotUserProfileAssigned(conn, client.user, profileName);

      /*
       * The swap alone governs the *next* login: RouterOS builds a hotspot session's dynamic queue
       * when the user authenticates, so an already-running session keeps the limit it started with.
       * Dropping the session is what puts the new speed in force now — and the portal's
       * auto-reconnect path logs a device with a live voucher straight back in, so the customer
       * sees a blip rather than a login screen.
       *
       * `moved` is what stops this becoming a kick loop, and it is load-bearing. The kick ends this
       * session, so the reconnect opens a *new* wifi_sessions row with isThrottled back at its
       * false default — and the next poll therefore sees a state mismatch all over again. On that
       * pass the router is already on the target profile, so `moved` is false, nothing is kicked,
       * and the flag is simply corrected. Kick unconditionally and the customer is dropped every
       * five seconds for as long as the throttle window lasts.
       */
      if (moved) await kickHotspotSession(conn, client.user);

      throttleBackoff.delete(session.sessionId);
      console.log(
        `[LiveMonitor] ${shouldThrottle ? "Throttled" : "Unthrottled"} user "${client.user}" ` +
          `→ profile "${profileName}"${moved ? " (reconnecting to apply)" : " (already set)"}`,
      );
    } catch (err) {
      // Latch the failure. Retrying a rejected command every 5s is how this pinned the CPU on an
      // hAP lite; the state stays honest in the DB either way, because it is only written below.
      throttleBackoff.set(session.sessionId, now + THROTTLE_RETRY_MS);
      console.error(
        `[LiveMonitor] Failed to move user "${client.user}" onto profile "${profileName}" — ` +
          `retrying in ${THROTTLE_RETRY_MS / 60_000} min:`,
        (err as Error).message,
      );
      continue;
    }

    // Outside the try on purpose: the flag must record what the *router* did, not what we intended.
    await db
      .update(wifiSessions)
      .set({ isThrottled: shouldThrottle })
      .where(eq(wifiSessions.id, session.sessionId));
  }
}

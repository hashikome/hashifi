import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { routers, vouchers, wifiSessions } from "../db/schema.js";
import { removeVouchersFromVenueRouters } from "./router-sync.js";

const CHECK_INTERVAL_MS = 60_000;

export function startExpiryDaemon(): void {
  const run = async () => {
    const now = new Date();

    // Close sessions that belong to routers in error or offline state.
    // These sessions are stale — the router went unreachable before the live
    // monitor could reconcile them, so they were never marked disconnected.
    const deadRouters = await db
      .select({ id: routers.id })
      .from(routers)
      .where(or(eq(routers.status, "error"), eq(routers.status, "offline")));

    if (deadRouters.length > 0) {
      const deadIds = deadRouters.map((r) => r.id).filter(Boolean) as string[];
      await db
        .update(wifiSessions)
        .set({ status: "disconnected", endedAt: now, terminationReason: "router_unreachable" })
        .where(and(eq(wifiSessions.status, "connected"), inArray(wifiSessions.routerId, deadIds)));
    }

    const expired = await db
      .select({
        id: vouchers.id,
        code: vouchers.code,
        venueId: vouchers.venueId,
        currentStatus: vouchers.status,
      })
      .from(vouchers)
      .where(
        and(
          isNotNull(vouchers.expiresAt),
          lt(vouchers.expiresAt, now),
          // pending_activation included: a voucher the router never confirmed still has
          // a deadline, and without this it would sit in that state forever.
          inArray(vouchers.status, ["unused", "pending_activation", "active"]),
        ),
      );

    if (expired.length === 0) return;

    const ids = expired.map((v) => v.id);

    // Close any open sessions before marking the vouchers final
    await db
      .update(wifiSessions)
      .set({ status: "expired", endedAt: now })
      .where(and(inArray(wifiSessions.voucherId, ids), eq(wifiSessions.status, "connected")));

    // "used"    = was activated (active) and ran out — the customer got their time/data
    // "expired" = was never used (unused) and the validity window passed
    const usedIds = expired.filter((v) => v.currentStatus === "active").map((v) => v.id);
    const expiredIds = expired.filter((v) => v.currentStatus === "unused").map((v) => v.id);

    if (usedIds.length > 0)
      await db.update(vouchers).set({ status: "used" }).where(inArray(vouchers.id, usedIds));
    if (expiredIds.length > 0)
      await db.update(vouchers).set({ status: "expired" }).where(inArray(vouchers.id, expiredIds));

    // Remove from MikroTik routers grouped by venue (fire-and-forget)
    const byVenue = new Map<string, string[]>();
    for (const v of expired) {
      if (v.venueId) {
        const list = byVenue.get(v.venueId) ?? [];
        list.push(v.code);
        byVenue.set(v.venueId, list);
      }
    }
    for (const [venueId, codes] of byVenue) {
      removeVouchersFromVenueRouters(venueId, codes).catch((err) =>
        console.error("[ExpiryDaemon] MikroTik remove failed:", err),
      );
    }

    console.log(`[ExpiryDaemon] Expired ${expired.length} voucher(s)`);
  };

  const interval = setInterval(() => {
    run().catch((err) => console.error("[ExpiryDaemon] Unhandled error:", err));
  }, CHECK_INTERVAL_MS);

  if (interval.unref) interval.unref();

  // Run immediately on startup to catch anything that expired while the server was down
  run().catch((err) => console.error("[ExpiryDaemon] Startup run error:", err));

  console.log("[ExpiryDaemon] Started — checking every 60s");
}

import type { PrismaClient } from "../generated/prisma/client.js";
import { enrichWideEvent } from "../observability/wide-event.js";
import type { RouterSync } from "../services/router-sync.js";

/**
 * Ends vouchers whose time is up, and the sessions they hold, then removes them from the
 * venue's routers. The router enforces the limit live; this keeps the records truthful.
 */
export class VoucherExpiry {
  constructor(
    private readonly db: PrismaClient,
    private readonly sync: RouterSync,
  ) {}

  async runOnce(now: Date = new Date()): Promise<{ vouchers: number; sessions: number }> {
    // Sessions on routers in error or offline went stale: the router became unreachable before
    // the live monitor could close them.
    const stale = await this.db.wifiSession.updateMany({
      where: { status: "connected", router: { status: { in: ["error", "offline"] } } },
      data: { status: "disconnected", endedAt: now, terminationReason: "router_unreachable" },
    });

    const expired = await this.db.voucher.findMany({
      where: {
        expiresAt: { lt: now },
        // pending_activation included: a voucher the router never confirmed still has a
        // deadline, and without it the voucher would wait in that state forever.
        status: { in: ["unused", "pending_activation", "active"] },
      },
      select: { id: true, code: true, venueId: true, status: true },
    });
    if (expired.length === 0) {
      enrichWideEvent({ "vouchers.expired": 0, "sessions.expired": stale.count });
      return { vouchers: 0, sessions: stale.count };
    }

    const ids = expired.map((v) => v.id);
    const closed = await this.db.wifiSession.updateMany({
      where: { voucherId: { in: ids }, status: "connected" },
      data: { status: "expired", endedAt: now },
    });

    // "used": it was active and ran out, so the guest had their time. "expired": the validity
    // window passed before it was ever confirmed active (unused, or pending on the router).
    const usedIds = expired.filter((v) => v.status === "active").map((v) => v.id);
    const lapsedIds = expired.filter((v) => v.status !== "active").map((v) => v.id);
    await this.db.$transaction([
      this.db.voucher.updateMany({ where: { id: { in: usedIds } }, data: { status: "used" } }),
      this.db.voucher.updateMany({ where: { id: { in: lapsedIds } }, data: { status: "expired" } }),
    ]);

    const byVenue = new Map<string, string[]>();
    for (const voucher of expired) {
      if (!voucher.venueId) continue;
      byVenue.set(voucher.venueId, [...(byVenue.get(voucher.venueId) ?? []), voucher.code]);
    }
    for (const [venueId, codes] of byVenue) await this.sync.removeVouchers(venueId, codes);

    const sessions = stale.count + closed.count;
    enrichWideEvent({ "vouchers.expired": expired.length, "sessions.expired": sessions });
    return { vouchers: expired.length, sessions };
  }
}

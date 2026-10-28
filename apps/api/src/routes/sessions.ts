import type { SQL } from "drizzle-orm";
import { and, desc, eq, like, or } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/index.js";
import { packages, routers, venues, vouchers, wifiCustomers, wifiSessions } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { kickVoucherFromVenueRouters } from "../services/router-sync.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();

router.use(requireAuth);

// List sessions with joined data
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const statusFilter =
      typeof req.query.status === "string" &&
      ["connected", "disconnected", "expired", "terminated"].includes(req.query.status)
        ? (req.query.status as "connected" | "disconnected" | "expired" | "terminated")
        : undefined;
    const venueId = typeof req.query.venueId === "string" ? req.query.venueId : undefined;

    const searchCondition = search
      ? or(
          like(wifiSessions.macAddress, `%${search}%`),
          like(wifiSessions.ipAddress, `%${search}%`),
          like(wifiSessions.deviceName, `%${search}%`),
          like(wifiCustomers.username, `%${search}%`),
          like(wifiCustomers.phone, `%${search}%`),
        )
      : undefined;

    const statusCondition = statusFilter ? eq(wifiSessions.status, statusFilter) : undefined;

    // Managers are scoped to their venue(s); honour any explicit venueId only within that scope
    let venueCondition: SQL | undefined;
    if (user.role === "manager") {
      const managerVenueCondition = eq(venues.operatorId, user.id);
      venueCondition = venueId
        ? and(eq(wifiSessions.venueId, venueId), managerVenueCondition)
        : managerVenueCondition;
    } else {
      venueCondition = venueId ? eq(wifiSessions.venueId, venueId) : undefined;
    }

    const where = and(searchCondition, statusCondition, venueCondition);

    const rows = await db
      .select({
        session: wifiSessions,
        customerUsername: wifiCustomers.username,
        customerPhone: wifiCustomers.phone,
        voucherCode: vouchers.code,
        packageName: packages.name,
        venueName: venues.name,
        routerName: routers.name,
        venueOperatorId: venues.operatorId,
      })
      .from(wifiSessions)
      .leftJoin(wifiCustomers, eq(wifiSessions.customerId, wifiCustomers.id))
      .leftJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
      .leftJoin(packages, eq(wifiSessions.packageId, packages.id))
      .leftJoin(venues, eq(wifiSessions.venueId, venues.id))
      .leftJoin(routers, eq(wifiSessions.routerId, routers.id))
      .where(where)
      .orderBy(desc(wifiSessions.startedAt));

    const stats = {
      total: rows.length,
      connected: rows.filter((r) => r.session.status === "connected").length,
      totalUploadBytes: rows.reduce((sum, r) => sum + r.session.uploadBytes, 0),
      totalDownloadBytes: rows.reduce((sum, r) => sum + r.session.downloadBytes, 0),
    };

    res.json({
      sessions: rows.map((r) =>
        serializeSessionRow({
          session: r.session,
          customerUsername: r.customerUsername,
          customerPhone: r.customerPhone,
          voucherCode: r.voucherCode,
          packageName: r.packageName,
          venueName: r.venueName,
          routerName: r.routerName,
        }),
      ),
      stats,
    });
  }),
);

// Get single session
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const baseCondition = eq(wifiSessions.id, req.params.id as string);
    const condition =
      user.role === "manager" ? and(baseCondition, eq(venues.operatorId, user.id)) : baseCondition;

    const rows = await db
      .select({
        session: wifiSessions,
        customerUsername: wifiCustomers.username,
        customerPhone: wifiCustomers.phone,
        voucherCode: vouchers.code,
        packageName: packages.name,
        venueName: venues.name,
        routerName: routers.name,
      })
      .from(wifiSessions)
      .leftJoin(wifiCustomers, eq(wifiSessions.customerId, wifiCustomers.id))
      .leftJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
      .leftJoin(packages, eq(wifiSessions.packageId, packages.id))
      .leftJoin(venues, eq(wifiSessions.venueId, venues.id))
      .leftJoin(routers, eq(wifiSessions.routerId, routers.id))
      .where(condition)
      .limit(1);

    if (!rows.length) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({ session: serializeSessionRow(rows[0]) });
  }),
);

// Terminate a session — admin always; manager only within their venue
router.patch(
  "/:id/terminate",
  requireRole("admin", "manager"),
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const [existing] = await db
      .select({
        session: wifiSessions,
        voucherCode: vouchers.code,
        venueOperatorId: venues.operatorId,
      })
      .from(wifiSessions)
      .leftJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
      .leftJoin(venues, eq(wifiSessions.venueId, venues.id))
      .where(eq(wifiSessions.id, req.params.id as string))
      .limit(1);

    if (user.role === "manager" && existing?.venueOperatorId !== user.id) {
      res.status(403).json({ error: "You can only terminate sessions in your assigned venue" });
      return;
    }

    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (existing.session.status !== "connected") {
      res.status(400).json({ error: "Session is not active" });
      return;
    }

    const now = new Date();
    const durationSeconds = Math.max(
      0,
      Math.floor((now.getTime() - existing.session.startedAt.getTime()) / 1000),
    );

    await db
      .update(wifiSessions)
      .set({
        status: "terminated",
        endedAt: now,
        durationSeconds,
        terminationReason: "admin_disconnect",
      })
      .where(eq(wifiSessions.id, req.params.id as string));

    // Fire-and-forget: kick the active MikroTik session immediately
    if (existing.voucherCode && existing.session.venueId) {
      kickVoucherFromVenueRouters(existing.session.venueId, existing.voucherCode).catch(() => {});
    }

    res.json({ ok: true, message: "Session terminated" });
  }),
);

type SessionRow = {
  session: typeof wifiSessions.$inferSelect;
  customerUsername: string | null;
  customerPhone: string | null;
  voucherCode: string | null;
  packageName: string | null;
  venueName: string | null;
  routerName: string | null;
};

function serializeSessionRow(row: SessionRow) {
  const { session, ...joins } = row;
  return {
    ...session,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    uploadSpeedMbps: session.uploadSpeedMbps ?? null,
    downloadSpeedMbps: session.downloadSpeedMbps ?? null,
    ...joins,
  };
}

export { router as sessionsRouter };

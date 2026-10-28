import { and, desc, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { wifiCustomers, wifiSessions } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();

router.use(requireAuth);

const customerUpdateSchema = z.object({
  username: z.string().max(120).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(32).optional(),
  macAddress: z.string().max(32).optional(),
  lastIpAddress: z.string().max(45).optional(),
  deviceName: z.string().max(160).optional(),
  deviceType: z.string().max(40).optional(),
  status: z.enum(["active", "inactive", "blocked"]).optional(),
});

// List customers
//
// Two different notions of "status" live here and must not be conflated:
//   • `wifi_customers.status` — the ACCOUNT flag (active/inactive/blocked). Nothing
//     writes it after the captive-portal insert, so it reads "active" for everyone
//     and says nothing about connectivity.
//   • an open `wifi_sessions` row (status = "connected") — whether the device is
//     ONLINE right now. This is what live-monitor reconciles against MikroTik, and
//     what the admin UI's connection badge reads.
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const statusFilter =
      typeof req.query.status === "string" &&
      ["online", "offline", "blocked"].includes(req.query.status)
        ? (req.query.status as "online" | "offline" | "blocked")
        : undefined;

    const searchCondition = search
      ? or(
          like(wifiCustomers.username, `%${search}%`),
          like(wifiCustomers.email, `%${search}%`),
          like(wifiCustomers.phone, `%${search}%`),
          like(wifiCustomers.macAddress, `%${search}%`),
          like(wifiCustomers.deviceName, `%${search}%`),
        )
      : undefined;

    const allRows = await db
      .select()
      .from(wifiCustomers)
      .where(searchCondition)
      .orderBy(desc(wifiCustomers.createdAt));

    // Customers with an open session = the ones actually on the WiFi right now.
    const onlineRows = await db
      .selectDistinct({ customerId: wifiSessions.customerId })
      .from(wifiSessions)
      .where(and(eq(wifiSessions.status, "connected"), isNotNull(wifiSessions.customerId)));
    const onlineIds = new Set(onlineRows.map((r) => r.customerId as string));

    // A blocked account is never reported as online, even if a session is still open —
    // the block is the more important fact to surface.
    const isOnline = (c: { id: string; status: string }) =>
      c.status !== "blocked" && onlineIds.has(c.id);

    const rows = statusFilter
      ? allRows.filter((r) =>
          statusFilter === "blocked"
            ? r.status === "blocked"
            : statusFilter === "online"
              ? isOnline(r)
              : r.status !== "blocked" && !isOnline(r),
        )
      : allRows;

    const all = await db
      .select({ id: wifiCustomers.id, status: wifiCustomers.status })
      .from(wifiCustomers);
    const blockedCount = all.filter((r) => r.status === "blocked").length;
    const onlineCount = all.filter(isOnline).length;
    const stats = {
      total: all.length,
      online: onlineCount,
      offline: all.length - blockedCount - onlineCount,
      blocked: blockedCount,
    };

    // Fetch total bytes per MAC for all returned customers
    const macs = rows.map((r) => r.macAddress).filter(Boolean) as string[];
    const usageMap = new Map<string, { download: number; upload: number }>();
    if (macs.length > 0) {
      const usageRows = await db
        .select({
          macAddress: wifiSessions.macAddress,
          totalDownload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.downloadBytes}), 0) AS CHAR)`,
          totalUpload: sql<string>`CAST(COALESCE(SUM(${wifiSessions.uploadBytes}), 0) AS CHAR)`,
        })
        .from(wifiSessions)
        .where(inArray(wifiSessions.macAddress, macs))
        .groupBy(wifiSessions.macAddress);
      for (const r of usageRows) {
        if (r.macAddress) {
          usageMap.set(r.macAddress, {
            download: Number(r.totalDownload),
            upload: Number(r.totalUpload),
          });
        }
      }
    }

    res.json({
      customers: rows.map((r) => ({
        ...serializeCustomer(r),
        isOnline: isOnline(r),
        totalDownloadBytes: usageMap.get(r.macAddress ?? "")?.download ?? 0,
        totalUploadBytes: usageMap.get(r.macAddress ?? "")?.upload ?? 0,
      })),
      total: rows.length,
      stats,
    });
  }),
);

// Get single customer
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const [customer] = await db
      .select()
      .from(wifiCustomers)
      .where(eq(wifiCustomers.id, req.params.id as string))
      .limit(1);

    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const [openSession] = await db
      .select({ id: wifiSessions.id })
      .from(wifiSessions)
      .where(and(eq(wifiSessions.customerId, customer.id), eq(wifiSessions.status, "connected")))
      .limit(1);

    res.json({
      customer: {
        ...serializeCustomer(customer),
        isOnline: customer.status !== "blocked" && !!openSession,
      },
    });
  }),
);

// Update customer
router.patch(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = customerUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const [existing] = await db
      .select({ id: wifiCustomers.id })
      .from(wifiCustomers)
      .where(eq(wifiCustomers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const { email, ...rest } = parsed.data;
    const updateData: Record<string, unknown> = { ...rest };
    if (email !== undefined) updateData.email = email === "" ? null : email;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    await db
      .update(wifiCustomers)
      .set(updateData)
      .where(eq(wifiCustomers.id, req.params.id as string));

    res.json({ ok: true, message: "Customer updated successfully" });
  }),
);

// Delete customer
router.delete(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const [existing] = await db
      .select({ id: wifiCustomers.id })
      .from(wifiCustomers)
      .where(eq(wifiCustomers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    await db.delete(wifiCustomers).where(eq(wifiCustomers.id, req.params.id as string));

    res.json({ ok: true, message: "Customer deleted successfully" });
  }),
);

function serializeCustomer(c: typeof wifiCustomers.$inferSelect) {
  return {
    ...c,
    joinedAt: c.joinedAt.toISOString(),
    lastActiveAt: c.lastActiveAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export { router as customersRouter };

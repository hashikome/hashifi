import { Router } from "express";
import { and, eq, desc, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  packages,
  portalSettings,
  voucherBatches,
  vouchers,
  venues,
  venuePackages,
} from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";
import {
  pushVouchersToVenueRouters,
  removeVoucherFromVenueRouters,
  removeVouchersFromVenueRouters,
} from "../services/router-sync.js";

const router = Router();

router.use(requireAuth);

import { randomUUID } from "node:crypto";
import { logAction } from "../utils/audit.js";

const generateVouchersSchema = z.object({
  packageId: z.string().uuid(),
  quantity: z.number().int().positive().max(1000),
  prefix: z.string().min(1).max(24).default("WIFI"),
  venueId: z.string().uuid(),
  expiryDays: z.number().int().positive().optional(),
});

// List all vouchers
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;

    let query = db
      .select({
        voucher: vouchers,
        packageName: packages.name,
        venueName: venues.name,
      })
      .from(vouchers)
      .leftJoin(packages, eq(vouchers.packageId, packages.id))
      .leftJoin(voucherBatches, eq(vouchers.batchId, voucherBatches.id))
      .leftJoin(venues, eq(vouchers.venueId, venues.id));

    if (user.role === "manager") {
      // Only vouchers for venues this manager operates
      query = query.where(and(isNotNull(vouchers.batchId), eq(venues.operatorId, user.id))) as any;
    } else {
      query = query.where(isNotNull(vouchers.batchId)) as any;
    }

    const result = await query.orderBy(desc(vouchers.createdAt));

    const allVouchers = result.map((r) => ({
      ...r.voucher,
      packageName: r.packageName,
      venueName: r.venueName ?? null,
    }));

    res.json({ vouchers: allVouchers });
  }),
);

// Get vouchers by codes (for printing)
router.get(
  "/by-codes",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const codesParam = req.query.codes as string;
    if (!codesParam) {
      res.status(400).json({ error: "No codes provided" });
      return;
    }

    const codeList = codesParam.split(",");
    const whereClause =
      user.role === "manager"
        ? and(
            isNotNull(vouchers.batchId),
            inArray(vouchers.code, codeList),
            eq(venues.operatorId, user.id),
          )
        : and(isNotNull(vouchers.batchId), inArray(vouchers.code, codeList));

    const result = await db
      .select({
        voucher: vouchers,
        packageName: packages.name,
        downloadSpeed: packages.downloadSpeedMbps,
        uploadSpeed: packages.uploadSpeedMbps,
        duration: packages.durationMinutes,
        venueName: venues.name,
      })
      .from(vouchers)
      .leftJoin(packages, eq(vouchers.packageId, packages.id))
      .leftJoin(voucherBatches, eq(vouchers.batchId, voucherBatches.id))
      .leftJoin(venues, eq(vouchers.venueId, venues.id))
      .where(whereClause);

    const foundVouchers = result.map((r) => ({
      ...r.voucher,
      packageName: r.packageName,
      downloadSpeed: r.downloadSpeed,
      uploadSpeed: r.uploadSpeed,
      duration: r.duration,
      venueName: r.venueName ?? null,
    }));

    res.json({ vouchers: foundVouchers });
  }),
);

// List voucher batches
router.get(
  "/batches",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;

    let query = db
      .select({
        batch: voucherBatches,
        venueName: venues.name,
      })
      .from(voucherBatches)
      .leftJoin(venues, eq(voucherBatches.venueId, venues.id));

    if (user.role === "manager") {
      query = query.where(eq(venues.operatorId, user.id)) as any;
    }

    const result = await query.orderBy(desc(voucherBatches.createdAt));
    const batches = result.map((r) => ({ ...r.batch, venueName: r.venueName ?? null }));

    res.json({ batches });
  }),
);

// Generate vouchers
router.post(
  "/generate",
  asyncRoute(async (req, res) => {
    const parsed = generateVouchersSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const { packageId, quantity, prefix, venueId, expiryDays } = parsed.data;
    const adminUser = (req as any).user;

    // Verify venue exists and manager owns it
    const [venue] = await db
      .select({ id: venues.id, operatorId: venues.operatorId })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    if (adminUser.role === "manager" && venue.operatorId !== adminUser.id) {
      res.status(403).json({ error: "You can only generate vouchers for your assigned venue" });
      return;
    }

    // Verify package exists
    const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);

    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    // Managers are restricted to assigned packages only when the venue has explicit assignments configured
    if (adminUser.role === "manager") {
      const [anyAssignment] = await db
        .select({ id: venuePackages.id })
        .from(venuePackages)
        .where(eq(venuePackages.venueId, venueId))
        .limit(1);

      if (anyAssignment) {
        const [thisAssignment] = await db
          .select({ id: venuePackages.id })
          .from(venuePackages)
          .where(and(eq(venuePackages.venueId, venueId), eq(venuePackages.packageId, packageId)))
          .limit(1);

        if (!thisAssignment) {
          res.status(403).json({ error: "This package is not assigned to your venue" });
          return;
        }
      }
    }

    let expiresAt: Date | undefined = undefined;
    if (expiryDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiryDays);
    }

    const batchId = randomUUID();

    await db.insert(voucherBatches).values({
      id: batchId,
      packageId,
      venueId,
      createdById: adminUser.id,
      quantity,
      prefix,
      expiresAt,
    });

    const newVouchers = [];
    for (let i = 0; i < quantity; i++) {
      const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const code = `${prefix}-${randomCode}`;

      newVouchers.push({
        id: randomUUID(),
        batchId,
        packageId,
        venueId,
        code,
        status: "unused" as const,
        dataLimitGb: pkg.dataLimitGb,
        durationMinutes: pkg.durationMinutes,
        priceTsh: pkg.priceTsh,
        expiresAt,
      });
    }

    await db.insert(vouchers).values(newVouchers);

    const normalizedPrefix = prefix.toUpperCase();
    const [portalRow] = await db.select({ id: portalSettings.id }).from(portalSettings).limit(1);
    if (portalRow) {
      await db
        .update(portalSettings)
        .set({ voucherPrefix: normalizedPrefix })
        .where(eq(portalSettings.id, portalRow.id));
    }

    // Fire-and-forget: push to all routers in the venue (non-blocking)
    pushVouchersToVenueRouters(
      venueId,
      newVouchers.map((v) => v.code),
      pkg,
      pkg.dataLimitGb ?? null,
    ).catch((err) => console.error("[RouterSync] Voucher push failed:", err));

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "vouchers_generated",
      entityType: "voucher",
      entityId: batchId,
      entityName: pkg.name,
      ipAddress: req.ip ?? null,
      details: { quantity, venueId, packageName: pkg.name },
    }).catch(() => {});

    res.status(201).json({
      ok: true,
      message: `${quantity} vouchers generated successfully`,
      batchId,
      count: quantity,
      codes: newVouchers.map((v) => v.code),
      prefix: normalizedPrefix,
    });
  }),
);

// Batch delete vouchers — admin only
router.delete(
  "/batch",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "No voucher IDs provided" });
      return;
    }

    const toDelete = await db
      .select({ code: vouchers.code, venueId: vouchers.venueId })
      .from(vouchers)
      .where(inArray(vouchers.id, ids));

    await db.delete(vouchers).where(inArray(vouchers.id, ids));

    const byVenue = new Map<string, string[]>();
    for (const v of toDelete) {
      if (v.venueId) {
        const existing = byVenue.get(v.venueId) ?? [];
        existing.push(v.code);
        byVenue.set(v.venueId, existing);
      }
    }
    for (const [venueId, codes] of byVenue) {
      removeVouchersFromVenueRouters(venueId, codes).catch((err) =>
        console.error("[RouterSync] Batch remove failed:", err),
      );
    }

    res.json({ ok: true, message: `${ids.length} vouchers deleted successfully` });
  }),
);

// Delete single voucher — admin only
router.delete(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const id = req.params.id as string;

    const [existing] = await db
      .select({ code: vouchers.code, venueId: vouchers.venueId })
      .from(vouchers)
      .where(eq(vouchers.id, id))
      .limit(1);

    await db.delete(vouchers).where(eq(vouchers.id, id));

    if (existing?.venueId) {
      removeVoucherFromVenueRouters(existing.venueId, existing.code).catch((err) =>
        console.error("[RouterSync] Remove failed:", err),
      );
    }

    res.json({ ok: true, message: "Voucher deleted successfully" });
  }),
);

export { router as vouchersRouter };

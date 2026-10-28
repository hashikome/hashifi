import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { packages, venuePackages, venues } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();

router.use(requireAuth);

const packageBaseSchema = z.object({
  name: z.string().min(1).max(180),
  packageType: z.enum(["hotspot", "home", "business", "premium"]).default("hotspot"),
  description: z.string().optional(),
  // Whole minutes (0014). 1 minute floor, 1 year ceiling — a typo of 100000 would otherwise
  // create a package that never expires.
  durationMinutes: z.number().int().min(1).max(525_600),
  downloadSpeedMbps: z.number().int().positive(),
  uploadSpeedMbps: z.number().int().positive().optional(),
  dataLimitGb: z.number().int().optional(),
  deviceLimit: z.number().int().positive().default(1),
  priceTsh: z.number().nonnegative(),
  features: z.array(z.string()),
  isActive: z.boolean().default(true),
  throttledDownloadMbps: z.number().int().positive().nullable().optional(),
  throttledUploadMbps: z.number().int().positive().nullable().optional(),
  peakStartHour: z.number().int().min(0).max(23).nullable().optional(),
  peakEndHour: z.number().int().min(0).max(23).nullable().optional(),
  throttleAfterGb: z.number().int().positive().nullable().optional(),
});

function refineThrottleSpeeds<
  T extends {
    downloadSpeedMbps?: number;
    uploadSpeedMbps?: number;
    throttledDownloadMbps?: number | null;
    throttledUploadMbps?: number | null;
  },
>(data: T, ctx: z.RefinementCtx) {
  if (data.throttledDownloadMbps != null && data.downloadSpeedMbps != null) {
    if (data.throttledDownloadMbps >= data.downloadSpeedMbps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["throttledDownloadMbps"],
        message: `Throttled download (${data.throttledDownloadMbps} Mbps) must be less than normal download (${data.downloadSpeedMbps} Mbps).`,
      });
    }
  }
  if (data.throttledUploadMbps != null) {
    const normalUp = data.uploadSpeedMbps ?? data.downloadSpeedMbps;
    if (normalUp != null && data.throttledUploadMbps >= normalUp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["throttledUploadMbps"],
        message: `Throttled upload (${data.throttledUploadMbps} Mbps) must be less than normal upload (${normalUp} Mbps).`,
      });
    }
  }
}

const packageSchema = packageBaseSchema.superRefine(refineThrottleSpeeds);
const packageUpdateSchema = packageBaseSchema.partial().superRefine(refineThrottleSpeeds);

// List packages — optionally filtered to those assigned to a venue
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const venueId = typeof req.query.venueId === "string" ? req.query.venueId : undefined;

    if (venueId) {
      const assignments = await db
        .select({ packageId: venuePackages.packageId })
        .from(venuePackages)
        .where(eq(venuePackages.venueId, venueId));

      const packageIds = assignments.map((a) => a.packageId);
      // If the venue has no explicit assignments, fall back to all active packages
      const filteredPackages =
        packageIds.length > 0
          ? await db
              .select()
              .from(packages)
              .where(and(inArray(packages.id, packageIds), eq(packages.isActive, true)))
              .orderBy(desc(packages.createdAt))
          : await db
              .select()
              .from(packages)
              .where(eq(packages.isActive, true))
              .orderBy(desc(packages.createdAt));

      res.json({ packages: filteredPackages });
      return;
    }

    const allPackages = await db.select().from(packages).orderBy(desc(packages.createdAt));

    res.json({ packages: allPackages });
  }),
);

// Get single package
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const [pkg] = await db
      .select()
      .from(packages)
      .where(eq(packages.id, req.params.id as string))
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    res.json({ package: pkg });
  }),
);

// Create package
router.post(
  "/",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = packageSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const { priceTsh, ...rest } = parsed.data;

    // We have to cast priceTsh to string for decimal column in insert, although numeric insertion usually works too depending on driver
    await db.insert(packages).values({
      ...rest,
      priceTsh: priceTsh.toString(),
    });

    res.status(201).json({ ok: true, message: "Package created successfully" });
  }),
);

// Update package
router.patch(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = packageUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const { priceTsh, ...rest } = parsed.data;

    const updateData: Record<string, any> = { ...rest };
    if (priceTsh !== undefined) {
      updateData.priceTsh = priceTsh.toString();
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [pkg] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.id, req.params.id as string))
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    await db
      .update(packages)
      .set(updateData)
      .where(eq(packages.id, req.params.id as string));

    res.json({ ok: true, message: "Package updated successfully" });
  }),
);

// Delete package
router.delete(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const [pkg] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.id, req.params.id as string))
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    await db.delete(packages).where(eq(packages.id, req.params.id as string));

    res.json({ ok: true, message: "Package deleted successfully" });
  }),
);

// Get packages assigned to a specific venue
router.get(
  "/venue/:venueId",
  asyncRoute(async (req, res) => {
    const venueId = req.params.venueId as string;
    const assignments = await db
      .select({ packageId: venuePackages.packageId })
      .from(venuePackages)
      .where(eq(venuePackages.venueId, venueId));

    const packageIds = assignments.map((a) => a.packageId);
    const assignedPackages =
      packageIds.length > 0
        ? await db
            .select()
            .from(packages)
            .where(inArray(packages.id, packageIds))
            .orderBy(desc(packages.createdAt))
        : [];

    res.json({ packages: assignedPackages, assignedPackageIds: packageIds });
  }),
);

// Assign a package to a venue — admin only
router.post(
  "/venue-assignments",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const schema = z.object({
      venueId: z.string().uuid(),
      packageId: z.string().uuid(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const { venueId, packageId } = parsed.data;

    const [[venueExists], [pkgExists]] = await Promise.all([
      db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId)).limit(1),
      db.select({ id: packages.id }).from(packages).where(eq(packages.id, packageId)).limit(1),
    ]);

    if (!venueExists) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }
    if (!pkgExists) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    await db
      .insert(venuePackages)
      .values({ id: randomUUID(), venueId, packageId })
      .onDuplicateKeyUpdate({ set: { venueId } });

    res.status(201).json({ ok: true, message: "Package assigned to venue" });
  }),
);

// Remove a package from a venue — admin only
router.delete(
  "/venue-assignments",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const schema = z.object({
      venueId: z.string().uuid(),
      packageId: z.string().uuid(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const { venueId, packageId } = parsed.data;
    await db
      .delete(venuePackages)
      .where(and(eq(venuePackages.venueId, venueId), eq(venuePackages.packageId, packageId)));

    res.json({ ok: true, message: "Package removed from venue" });
  }),
);

export { router as packagesRouter };

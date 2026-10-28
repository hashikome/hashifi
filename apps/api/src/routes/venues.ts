import { and, count, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { routers, venues } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { logAction } from "../utils/audit.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();

router.use(requireAuth);

const venueSchema = z.object({
  name: z.string().min(1).max(180),
  description: z.string().optional(),
  address: z.string().max(255).optional(),
  road: z.string().max(120).optional(),
  street: z.string().max(120).optional(),
  ward: z.string().max(120).optional(),
  district: z.string().max(120).optional(),
  city: z.string().min(1).max(120),
  region: z.string().min(1).max(120),
  country: z.string().max(120).default("Tanzania"),
  postalCode: z.string().max(30).optional(),
  contactPhone: z.string().max(32).optional(),
  contactEmail: z.string().email().max(255).optional().or(z.literal("")),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
  operatorId: z.string().uuid().optional(),
});

const venueUpdateSchema = venueSchema.partial();

// List venues (with router count per venue)
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;

    const baseQuery = db
      .select({
        id: venues.id,
        name: venues.name,
        description: venues.description,
        address: venues.address,
        road: venues.road,
        street: venues.street,
        ward: venues.ward,
        district: venues.district,
        city: venues.city,
        region: venues.region,
        country: venues.country,
        postalCode: venues.postalCode,
        contactPhone: venues.contactPhone,
        contactEmail: venues.contactEmail,
        latitude: venues.latitude,
        longitude: venues.longitude,
        operatorId: venues.operatorId,
        status: venues.status,
        createdAt: venues.createdAt,
        updatedAt: venues.updatedAt,
        routerCount: count(routers.id),
      })
      .from(venues)
      .leftJoin(routers, eq(routers.venueId, venues.id))
      .groupBy(venues.id)
      .orderBy(desc(venues.createdAt));

    const result =
      user.role === "manager"
        ? await baseQuery.where(eq(venues.operatorId, user.id))
        : await baseQuery;

    res.json({ venues: result });
  }),
);

// Get single venue
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const condition =
      user.role === "manager"
        ? and(eq(venues.id, req.params.id as string), eq(venues.operatorId, user.id))
        : eq(venues.id, req.params.id as string);

    const [venue] = await db.select().from(venues).where(condition).limit(1);

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    res.json({ venue });
  }),
);

// Create venue
router.post(
  "/",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = venueSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const { latitude, longitude, contactEmail, ...rest } = parsed.data;

    await db.insert(venues).values({
      ...rest,
      contactEmail: contactEmail || null,
      latitude: latitude !== undefined ? latitude.toString() : null,
      longitude: longitude !== undefined ? longitude.toString() : null,
    });

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "venue_created",
      entityType: "venue",
      entityName: parsed.data.name,
      ipAddress: req.ip ?? null,
    }).catch(() => {});

    res.status(201).json({ ok: true, message: "Venue created successfully" });
  }),
);

// Update venue
router.patch(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = venueUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const [venue] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, req.params.id as string))
      .limit(1);

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    const { latitude, longitude, contactEmail, ...rest } = parsed.data;
    const updateData: Record<string, unknown> = { ...rest };

    if (contactEmail !== undefined) updateData.contactEmail = contactEmail || null;
    if (latitude !== undefined) updateData.latitude = latitude.toString();
    if (longitude !== undefined) updateData.longitude = longitude.toString();

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    await db
      .update(venues)
      .set(updateData)
      .where(eq(venues.id, req.params.id as string));

    res.json({ ok: true, message: "Venue updated successfully" });
  }),
);

// Delete venue
router.delete(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const [venue] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, req.params.id as string))
      .limit(1);

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    const [venueRow] = await db
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, req.params.id as string))
      .limit(1);
    await db.delete(venues).where(eq(venues.id, req.params.id as string));

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "venue_deleted",
      entityType: "venue",
      entityId: req.params.id as string,
      entityName: venueRow?.name ?? null,
      ipAddress: req.ip ?? null,
    }).catch(() => {});

    res.json({ ok: true, message: "Venue deleted successfully" });
  }),
);

export { router as venuesRouter };

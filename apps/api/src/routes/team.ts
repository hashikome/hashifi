import { randomUUID } from "node:crypto";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import {
  adminOtpCodes,
  adminPreferences,
  adminSessions,
  adminUsers,
  venues,
} from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { logAction } from "../utils/audit.js";
import {
  sendAccountDeletedEmail,
  sendAccountReactivatedEmail,
  sendAccountSuspendedEmail,
  sendDemotedToManagerEmail,
  sendProfileUpdatedEmail,
  sendPromotedToAdminEmail,
  sendWelcomeEmail,
} from "../utils/mailer.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

function normalizeTzPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let local: string;
  if (digits.startsWith("255") && digits.length === 12) {
    local = digits.slice(3);
  } else if (digits.startsWith("0") && digits.length === 10) {
    local = digits.slice(1);
  } else if (digits.length === 9) {
    local = digits;
  } else {
    return null;
  }
  if (!/^[67]\d{8}$/.test(local)) return null;
  return `+255${local}`;
}

const createSchema = z.object({
  name: z.string().min(1).max(160).trim(),
  email: z.string().email().max(255),
  phone: z.string().max(32).optional().nullable(),
  role: z.enum(["admin", "manager"]).default("manager"),
  venueId: z.string().uuid().optional().nullable(),
});

const demoteSchema = z.object({
  venueId: z.string().uuid().optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(160).trim().optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(32).optional().nullable(),
  venueId: z.string().uuid().optional().nullable(),
});

type MemberRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "admin" | "manager";
  status: "active" | "inactive" | "suspended";
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  venueId: string | null;
  venueName: string | null;
};

function serializeMember(row: MemberRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    role: row.role,
    status: row.status,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    assignedVenue: row.venueId ? { id: row.venueId, name: row.venueName! } : null,
  };
}

const memberSelect = {
  id: adminUsers.id,
  name: adminUsers.name,
  email: adminUsers.email,
  phone: adminUsers.phone,
  role: adminUsers.role,
  status: adminUsers.status,
  lastLoginAt: adminUsers.lastLoginAt,
  createdAt: adminUsers.createdAt,
  updatedAt: adminUsers.updatedAt,
  venueId: venues.id,
  venueName: venues.name,
} as const;

// GET / — list all team members with assigned venue
router.get(
  "/",
  asyncRoute(async (_req, res) => {
    const rows = await db
      .select(memberSelect)
      .from(adminUsers)
      .leftJoin(venues, eq(venues.operatorId, adminUsers.id))
      .orderBy(desc(adminUsers.createdAt));

    res.json({ members: (rows as MemberRow[]).map(serializeMember) });
  }),
);

// GET /:id — single member
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const [row] = await db
      .select(memberSelect)
      .from(adminUsers)
      .leftJoin(venues, eq(venues.operatorId, adminUsers.id))
      .where(eq(adminUsers.id, req.params.id as string))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    res.json({ member: serializeMember(row as MemberRow) });
  }),
);

// POST / — create new team member
router.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const { name, phone, role, venueId } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();

    const [existing] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "A team member with this email already exists" });
      return;
    }

    let normalizedPhone: string | null = null;
    if (phone) {
      normalizedPhone = normalizeTzPhone(phone);
      if (!normalizedPhone) {
        res.status(400).json({ error: "Invalid Tanzania phone number" });
        return;
      }
    }

    const newId = randomUUID();

    await db.insert(adminUsers).values({
      id: newId,
      name,
      email,
      phone: normalizedPhone,
      role,
      status: "active",
    });

    await db.insert(adminPreferences).values({ adminUserId: newId });

    if (venueId && role === "manager") {
      await db.update(venues).set({ operatorId: newId }).where(eq(venues.id, venueId));
    }

    sendWelcomeEmail(email, name, role).catch((err) => {
      console.warn("[Mailer] Failed to send welcome email:", err);
    });

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "member_created",
      entityType: "team_member",
      entityId: newId,
      entityName: name,
      ipAddress: req.ip ?? null,
      details: { role, email },
    }).catch((err: Error) => console.error("[Audit] Log failed:", err.message));

    res.status(201).json({ ok: true, id: newId, message: "Team member created" });
  }),
);

// PATCH /:id — update details
router.patch(
  "/:id",
  asyncRoute(async (req, res) => {
    const { id } = req.params as { id: string };
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    if (!user) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    const { name, email, phone, venueId } = parsed.data;
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;

    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();
      const [dupe] = await db
        .select({ id: adminUsers.id })
        .from(adminUsers)
        .where(and(eq(adminUsers.email, normalizedEmail), ne(adminUsers.id, id)))
        .limit(1);
      if (dupe) {
        res.status(409).json({ error: "Email is already in use by another team member" });
        return;
      }
      updates.email = normalizedEmail;
    }

    if (phone !== undefined) {
      if (!phone) {
        updates.phone = null;
      } else {
        const norm = normalizeTzPhone(phone);
        if (!norm) {
          res.status(400).json({ error: "Invalid Tanzania phone number" });
          return;
        }
        updates.phone = norm;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(adminUsers).set(updates).where(eq(adminUsers.id, id));
    }

    if (venueId !== undefined) {
      await db.update(venues).set({ operatorId: null }).where(eq(venues.operatorId, id));
      if (venueId) {
        await db.update(venues).set({ operatorId: id }).where(eq(venues.id, venueId));
      }
    }

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "member_updated",
      entityType: "team_member",
      entityId: id,
      entityName: user.name,
      ipAddress: req.ip ?? null,
    }).catch((err: Error) => console.error("[Audit] Log failed:", err.message));

    // Notify the affected member (use updated email if it changed)
    const notifyEmail = (updates.email as string | undefined) ?? user.email;
    const notifyName = (updates.name as string | undefined) ?? user.name;
    sendProfileUpdatedEmail(notifyEmail, notifyName).catch((err: Error) =>
      console.warn("[Mailer] Failed to send profile updated email:", err.message),
    );

    res.json({ ok: true, message: "Team member updated" });
  }),
);

// PATCH /:id/status — suspend or activate
router.patch(
  "/:id/status",
  asyncRoute(async (req, res) => {
    const { id } = req.params as { id: string };
    const currentUser = (req as any).user;

    if (id === currentUser.id) {
      res.status(400).json({ error: "You cannot change your own account status" });
      return;
    }

    const action = z.enum(["suspend", "activate"]).safeParse(req.body?.action);
    if (!action.success) {
      res.status(400).json({ error: "action must be 'suspend' or 'activate'" });
      return;
    }

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    if (!user) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    const newStatus = action.data === "suspend" ? "suspended" : "active";

    if (user.status === newStatus) {
      res.json({ ok: true, message: `Account is already ${newStatus}` });
      return;
    }

    await db.update(adminUsers).set({ status: newStatus }).where(eq(adminUsers.id, id));

    if (newStatus === "suspended") {
      await db
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(adminSessions.adminUserId, id));

      sendAccountSuspendedEmail(user.email, user.name).catch((err) => {
        console.warn("[Mailer] Failed to send suspended email:", err);
      });
    } else {
      sendAccountReactivatedEmail(user.email, user.name).catch((err) => {
        console.warn("[Mailer] Failed to send reactivated email:", err);
      });
    }

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: newStatus === "suspended" ? "member_suspended" : "member_activated",
      entityType: "team_member",
      entityId: id,
      entityName: user.name,
      ipAddress: req.ip ?? null,
    }).catch((err: Error) => console.error("[Audit] Log failed:", err.message));

    res.json({ ok: true, message: `Account ${newStatus}` });
  }),
);

// PATCH /:id/promote — promote manager to admin
router.patch(
  "/:id/promote",
  asyncRoute(async (req, res) => {
    const { id } = req.params as { id: string };

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    if (!user) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    if (user.role === "admin") {
      res.status(400).json({ error: "User is already an admin" });
      return;
    }

    await db.update(adminUsers).set({ role: "admin" }).where(eq(adminUsers.id, id));

    await db.update(venues).set({ operatorId: null }).where(eq(venues.operatorId, id));

    sendPromotedToAdminEmail(user.email, user.name).catch((err) => {
      console.warn("[Mailer] Failed to send promotion email:", err);
    });

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "member_promoted",
      entityType: "team_member",
      entityId: id,
      entityName: user.name,
      ipAddress: req.ip ?? null,
    }).catch((err: Error) => console.error("[Audit] Log failed:", err.message));

    res.json({ ok: true, message: "Team member promoted to admin" });
  }),
);

// PATCH /:id/demote — demote admin to manager, optionally assigning a venue
router.patch(
  "/:id/demote",
  asyncRoute(async (req, res) => {
    const { id } = req.params as { id: string };
    const currentUser = (req as any).user;

    if (id === currentUser.id) {
      res.status(400).json({ error: "You cannot demote your own account" });
      return;
    }

    const parsed = demoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    if (!user) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    if (user.role !== "admin") {
      res.status(400).json({ error: "User is not an admin" });
      return;
    }

    const [{ total }] = await db
      .select({ total: count(adminUsers.id) })
      .from(adminUsers)
      .where(eq(adminUsers.role, "admin"));

    if (total <= 1) {
      res.status(400).json({ error: "Cannot demote the last admin account" });
      return;
    }

    const { venueId } = parsed.data;

    await db.update(adminUsers).set({ role: "manager" }).where(eq(adminUsers.id, id));

    let venueName: string | null = null;
    if (venueId) {
      await db.update(venues).set({ operatorId: id }).where(eq(venues.id, venueId));
      const [venue] = await db
        .select({ name: venues.name })
        .from(venues)
        .where(eq(venues.id, venueId))
        .limit(1);
      venueName = venue?.name ?? null;
    }

    sendDemotedToManagerEmail(user.email, user.name, venueName).catch((err) => {
      console.warn("[Mailer] Failed to send demotion email:", err);
    });

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "member_demoted",
      entityType: "team_member",
      entityId: id,
      entityName: user.name,
      ipAddress: req.ip ?? null,
      details: { venueName },
    }).catch((err: Error) => console.error("[Audit] Log failed:", err.message));

    res.json({ ok: true, message: "Team member demoted to manager" });
  }),
);

// DELETE /:id — remove team member
router.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    const { id } = req.params as { id: string };
    const currentUser = (req as any).user;

    if (id === currentUser.id) {
      res.status(400).json({ error: "You cannot delete your own account" });
      return;
    }

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    if (!user) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }

    if (user.role === "admin") {
      const [{ total }] = await db
        .select({ total: count(adminUsers.id) })
        .from(adminUsers)
        .where(eq(adminUsers.role, "admin"));

      if (total <= 1) {
        res.status(400).json({ error: "Cannot delete the last admin account" });
        return;
      }
    }

    sendAccountDeletedEmail(user.email, user.name).catch((err) => {
      console.warn("[Mailer] Failed to send deletion email:", err);
    });

    await db.update(venues).set({ operatorId: null }).where(eq(venues.operatorId, id));
    await db.delete(adminPreferences).where(eq(adminPreferences.adminUserId, id));
    await db.delete(adminOtpCodes).where(eq(adminOtpCodes.adminUserId, id));
    await db.delete(adminSessions).where(eq(adminSessions.adminUserId, id));
    await db.delete(adminUsers).where(eq(adminUsers.id, id));

    const actor = (req as any).user;
    logAction({
      adminUserId: actor.id,
      actorName: actor.name,
      action: "member_deleted",
      entityType: "team_member",
      entityId: id,
      entityName: user.name,
      ipAddress: req.ip ?? null,
      details: { email: user.email, role: user.role },
    }).catch((err: Error) => console.error("[Audit] Log failed:", err.message));

    res.json({ ok: true, message: "Team member removed" });
  }),
);

export { router as teamRouter };

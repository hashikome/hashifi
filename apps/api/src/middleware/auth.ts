import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/index.js";
import { adminSessions, adminUsers } from "../db/schema.js";

const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "hashifi_session";

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function findActiveSession(req: Request) {
  const token = req.cookies?.[sessionCookieName];

  if (!token || typeof token !== "string") {
    return null;
  }

  const [session] = await db
    .select()
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.tokenHash, hashSecret(token)),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return session ?? null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await findActiveSession(req);

    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const [user] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, session.adminUserId))
      .limit(1);

    if (user?.status !== "active") {
      res.clearCookie(sessionCookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    await db
      .update(adminSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(adminSessions.id, session.id));

    // Extend request with user
    (req as any).user = user;
    (req as any).session = session;

    next();
  } catch (err) {
    next(err);
  }
}

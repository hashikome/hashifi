import { Router } from "express";
import { desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireRole("admin"),
  asyncRoute(async (_req, res) => {
    const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(50);

    res.json({ logs });
  }),
);

export { router as auditRouter };

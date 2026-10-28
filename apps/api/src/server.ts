import { randomBytes, randomInt } from "node:crypto";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";
import { startExpiryDaemon } from "./services/expiry-daemon.js";
import { startLiveMonitor } from "./services/live-monitor.js";
import { startProvisionBroadcast } from "./services/provision-broadcast.js";
import { startReconcileDaemon } from "./services/reconcile-daemon.js";
import { sendOtpEmail } from "./utils/mailer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db/index.js";
import { adminOtpCodes, adminSessions, adminUsers } from "./db/schema.js";
import { hashSecret, requireAuth } from "./middleware/auth.js";
import { analyticsRouter } from "./routes/analytics.js";
import { auditRouter } from "./routes/audit.js";
import { captivePortalRouter } from "./routes/captive-portal.js";
import { customersRouter } from "./routes/customers.js";
import { packagesRouter } from "./routes/packages.js";
import { paymentsRouter } from "./routes/payments.js";
import { portalRouter } from "./routes/portal.js";
import { revenueRouter } from "./routes/revenue.js";
import { routersRouter } from "./routes/routers.js";
import { sessionsRouter } from "./routes/sessions.js";
import { snippeWebhookRouter } from "./routes/snippe-webhook.js";
import { teamRouter } from "./routes/team.js";
import { venuesRouter } from "./routes/venues.js";
import { vouchersRouter } from "./routes/vouchers.js";
import { asyncRoute } from "./utils/route.js";

const port = Number(process.env.PORT ?? 8080);
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:4000";
const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "hashifi_session";
const sessionDurationMs = 3 * 24 * 60 * 60 * 1000;
const otpDurationMs = 10 * 60 * 1000;

type AdminUserRecord = typeof adminUsers.$inferSelect;

const app = express();

app.set("trust proxy", true);

const adminCors = cors({ origin: frontendOrigin, credentials: true });
const portalCors = cors({ origin: "*" });

// Admin API — restricted to the frontend origin
app.use("/api", adminCors);
app.use("/uploads", adminCors);

// Captive portal — open to any origin (WiFi users don't have a predictable origin)
app.use("/portal", portalCors);

// Snippe webhook must be mounted before express.json() so express.raw() can read the raw body
app.use("/webhooks", snippeWebhookRouter);

app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(join(__dirname, "../uploads")));

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function normalizeEmail(email: unknown) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function accountStatusMessage(status: "inactive" | "suspended"): string {
  if (status === "suspended") {
    return "Your account has been suspended. Contact your system administrator.";
  }
  return "Your account is inactive. Contact your system administrator.";
}

function serializeAdminUser(user: AdminUserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "hashifi-api" });
});

app.post(
  "/api/auth/request-otp",
  asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);

    if (!user) {
      res.status(404).json({ error: "Admin user not found" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: accountStatusMessage(user.status) });
      return;
    }

    const otp = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + otpDurationMs);

    await db.insert(adminOtpCodes).values({
      adminUserId: user.id,
      codeHash: hashSecret(otp),
      expiresAt,
    });

    await sendOtpEmail(email, otp, user.name);

    res.json({ ok: true });
  }),
);

app.post(
  "/api/auth/verify-otp",
  asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";

    if (!email || !/^\d{6}$/.test(otp)) {
      res.status(400).json({ error: "A valid email and 6-digit OTP are required" });
      return;
    }

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);

    if (!user) {
      res.status(401).json({ error: "Invalid OTP" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: accountStatusMessage(user.status) });
      return;
    }

    const [otpRecord] = await db
      .select()
      .from(adminOtpCodes)
      .where(
        and(
          eq(adminOtpCodes.adminUserId, user.id),
          isNull(adminOtpCodes.consumedAt),
          gt(adminOtpCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(adminOtpCodes.createdAt))
      .limit(1);

    if (!otpRecord || otpRecord.attempts >= 5) {
      res.status(401).json({ error: "Invalid OTP" });
      return;
    }

    if (otpRecord.codeHash !== hashSecret(otp)) {
      await db
        .update(adminOtpCodes)
        .set({ attempts: otpRecord.attempts + 1 })
        .where(eq(adminOtpCodes.id, otpRecord.id));

      res.status(401).json({ error: "Invalid OTP" });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionDurationMs);
    const sessionToken = randomBytes(32).toString("hex");

    await db
      .update(adminOtpCodes)
      .set({ consumedAt: now })
      .where(eq(adminOtpCodes.id, otpRecord.id));

    await db.insert(adminSessions).values({
      adminUserId: user.id,
      tokenHash: hashSecret(sessionToken),
      expiresAt,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    await db.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, user.id));

    res.cookie(sessionCookieName, sessionToken, {
      ...cookieOptions,
      maxAge: sessionDurationMs,
    });

    res.json({ user: serializeAdminUser(user) });
  }),
);

app.get(
  "/api/auth/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    res.json({ user: serializeAdminUser(user) });
  }),
);

app.patch(
  "/api/auth/profile",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = (req as any).user as AdminUserRecord;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;

    if (!name || name.length === 0) {
      res.status(400).json({ error: "Name is required" });
      return;
    }
    if (name.length > 160) {
      res.status(400).json({ error: "Name must be 160 characters or fewer" });
      return;
    }

    await db.update(adminUsers).set({ name }).where(eq(adminUsers.id, user.id));

    res.json({ ok: true, user: serializeAdminUser({ ...user, name }) });
  }),
);

app.post(
  "/api/auth/logout",
  requireAuth,
  asyncRoute(async (req, res) => {
    const session = (req as any).session;

    await db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(eq(adminSessions.id, session.id));

    res.clearCookie(sessionCookieName, cookieOptions);
    res.json({ ok: true });
  }),
);

app.use("/api/packages", packagesRouter);
app.use("/api/vouchers", vouchersRouter);
app.use("/api/venues", venuesRouter);
app.use("/api/routers", routersRouter);
app.use("/api/customers", customersRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/revenue", revenueRouter);
app.use("/api/portal", portalRouter);
app.use("/api/team", teamRouter);
app.use("/api/audit", auditRouter);
app.use("/portal", captivePortalRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[HashiFi] API error", err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = createServer(app);

// WebSocket live feed — shares the same port as the HTTP API
const wss = new WebSocketServer({ server: httpServer, path: "/ws/live" });
startLiveMonitor(wss);
startProvisionBroadcast(wss);
startExpiryDaemon();
startReconcileDaemon();

httpServer.listen(port, () => {
  console.log(`[HashiFi] Backend API running on http://localhost:${port}`);
  console.log(`[HashiFi] WebSocket live feed on ws://localhost:${port}/ws/live`);
  console.log(`[HashiFi] CORS origin: ${frontendOrigin}`);
});

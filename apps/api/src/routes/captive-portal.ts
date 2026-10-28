import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { UAParser } from "ua-parser-js";
import { db } from "../db/index.js";
import {
  packages,
  payments,
  portalSettings,
  routers,
  vouchers,
  wifiCustomers,
  wifiSessions,
} from "../db/schema.js";
import { asyncRoute } from "../utils/route.js";
import { normalizeTzPhone } from "../utils/phone.js";
import {
  DURATION_BUCKETS,
  durationShort,
  formatDuration,
  minutesToMs,
} from "../utils/duration.js";
import {
  SNIPPE_TERMINAL_FAILURE_STATUSES,
  markPaymentFailed,
  processPaymentCompleted,
} from "../utils/snippe.js";
import {
  describeFailures,
  ensureVoucherOnVenueRouters,
  outcomeOk,
} from "../services/router-sync.js";
import {
  PORTAL_FILES,
  renderPortalFile,
  type PortalFileName,
} from "../services/router-provision/portal-files.js";

export const captivePortalRouter = Router();

// ─── GET /portal/hotspot-files/:name ────────────────────────────────────────
// Serves the hotspot HTML pages with this backend's address templated in, so a router
// can pull them with `/tool fetch` during provisioning (RouterOS 6 has no /file/add).
// Public by necessity — the router fetches this before any session exists.
captivePortalRouter.get(
  "/hotspot-files/:name",
  asyncRoute(async (req, res) => {
    const name = req.params.name as string;
    if (!(PORTAL_FILES as readonly string[]).includes(name)) {
      res.status(404).json({ error: "Unknown hotspot file" });
      return;
    }

    const backendUrl =
      process.env.BACKEND_LAN_URL ?? `http://${req.hostname}:${process.env.PORT ?? "8080"}`;

    const html = await renderPortalFile(name as PortalFileName, backendUrl);
    res.type("html").send(html);
  }),
);

// ─── GET /portal/login ──────────────────────────────────────────────────────
// MikroTik redirects unauthenticated users here with these query params:
//   mac, ip, link-login, link-orig, chap-id, chap-challenge
// When these are absent the user is just browsing directly — show "connect first".
captivePortalRouter.get(
  "/login",
  asyncRoute(async (req, res) => {
    const [settings] = await db
      .select()
      .from(portalSettings)
      .where(eq(portalSettings.isActive, true))
      .limit(1);

    const pkgs = await db
      .select()
      .from(packages)
      .where(and(eq(packages.isActive, true), eq(packages.packageType, "hotspot")));

    const mac = (req.query.mac as string) ?? "";
    const ip = (req.query.ip as string) ?? "";
    const linkLogin = (req.query["link-login"] as string) ?? "";
    const linkOrig = (req.query["link-orig"] as string) ?? "";
    const chapId = (req.query["chap-id"] as string) ?? "";
    const chapChallenge = (req.query["chap-challenge"] as string) ?? "";

    // When the user scans the QR code, MikroTik intercepts and puts the
    // original QR URL (which contains ?code=...) into link-orig.
    let prefilledCode = (req.query.code as string) ?? "";
    if (!prefilledCode && linkOrig) {
      try {
        const origUrl = new URL(decodeURIComponent(linkOrig));
        prefilledCode = origUrl.searchParams.get("code") ?? "";
      } catch {
        // malformed link-orig — ignore
      }
    }

    const fromMikrotik = !!(mac && linkLogin);

    // Resolve venueId at render time so it can be embedded in the page and
    // sent with the payment request — avoids a second IP lookup that can fail.
    let venueId: string = "";
    if (linkLogin) {
      try {
        const routerIp = new URL(linkLogin).hostname;
        const [router] = await db
          .select({ venueId: routers.venueId })
          .from(routers)
          .where(or(eq(routers.ipAddress, routerIp), eq(routers.hotspotGatewayIp, routerIp)))
          .limit(1);
        venueId = router?.venueId ?? "";
      } catch {
        /* malformed URL — leave empty */
      }
    }

    // Auto-reconnect: if this MAC already has an active unexpired voucher,
    // skip the form entirely and submit straight to MikroTik.
    if (fromMikrotik && mac) {
      const [activeVoucher] = await db
        .select({ code: vouchers.code })
        .from(wifiSessions)
        .innerJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
        .where(
          and(
            eq(wifiSessions.macAddress, mac),
            eq(vouchers.status, "active"),
            or(isNull(vouchers.expiresAt), gt(vouchers.expiresAt, new Date())),
          ),
        )
        .orderBy(desc(wifiSessions.startedAt))
        .limit(1);

      if (activeVoucher) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store, no-cache");
        res.send(
          renderAutoReconnect({
            code: activeVoucher.code,
            linkLogin,
            linkOrig,
            primary: settings?.primaryColor ?? "#3b82f6",
            bg: settings?.backgroundColor ?? "#1e3a5f",
            brandName: settings?.brandName ?? "WiFi Portal",
          }),
        );
        return;
      }
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.send(
      renderPortalPage({
        settings: settings ?? null,
        packages: pkgs,
        fromMikrotik,
        mac,
        ip,
        linkLogin,
        linkOrig,
        chapId,
        chapChallenge,
        prefilledCode,
        venueId,
      }),
    );
  }),
);

function parseDeviceInfo(ua: string): { deviceType: string; deviceName: string } {
  const parser = new UAParser(ua);
  const device = parser.getDevice();
  const os = parser.getOS();

  // Build a human-readable name: prefer brand+model, fall back to OS-based label
  let deviceName: string;
  if (device.vendor && device.model) {
    // e.g. "Samsung SM-A576B" → UAParser resolves to "Samsung Galaxy A57 5G" when known
    deviceName = device.model.toLowerCase().startsWith(device.vendor.toLowerCase())
      ? device.model // model already includes brand
      : `${device.vendor} ${device.model}`;
  } else if (os.name === "iOS") {
    deviceName = device.type === "tablet" ? "iPad" : "iPhone";
  } else if (os.name === "macOS") {
    deviceName = "Mac";
  } else if (os.name === "Windows") {
    deviceName = "Windows PC";
  } else if (os.name?.toLowerCase().includes("android")) {
    deviceName = device.type === "tablet" ? "Android Tablet" : "Android Phone";
  } else {
    deviceName = os.name ? `${os.name} Device` : "Unknown Device";
  }

  // Determine device category
  let deviceType: string;
  switch (device.type) {
    case "mobile":
      deviceType = "phone";
      break;
    case "tablet":
      deviceType = "tablet";
      break;
    case "smarttv":
    case "console":
    case "embedded":
      deviceType = "other";
      break;
    default:
      deviceType = /android|iphone|ipad|windows phone/i.test(ua) ? "phone" : "desktop";
  }

  return { deviceType, deviceName };
}

// ─── POST /portal/validate-voucher ──────────────────────────────────────────
// Validates a voucher, enforces device limits, activates on first use,
// records customer + session, and returns MikroTik credentials.
captivePortalRouter.post(
  "/validate-voucher",
  asyncRoute(async (req, res) => {
    const raw = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    const mac = typeof req.body?.mac === "string" ? req.body.mac.trim() : "";
    const ip = typeof req.body?.ip === "string" ? req.body.ip.trim() : "";
    const linkLogin = typeof req.body?.linkLogin === "string" ? req.body.linkLogin.trim() : "";
    const { deviceType, deviceName } = parseDeviceInfo(req.headers["user-agent"] ?? "");

    if (!raw) {
      res.status(400).json({ error: "Voucher code is required." });
      return;
    }

    // Fetch voucher with package details (need deviceLimit)
    const [voucher] = await db
      .select({
        id: vouchers.id,
        code: vouchers.code,
        status: vouchers.status,
        expiresAt: vouchers.expiresAt,
        activatedAt: vouchers.activatedAt,
        durationMinutes: vouchers.durationMinutes,
        packageId: vouchers.packageId,
        venueId: vouchers.venueId,
        deviceLimit: packages.deviceLimit,
      })
      .from(vouchers)
      .leftJoin(packages, eq(vouchers.packageId, packages.id))
      .where(eq(vouchers.code, raw))
      .limit(1);

    if (!voucher) {
      res.status(404).json({ error: "Invalid voucher code. Please check and try again." });
      return;
    }

    if (voucher.status === "revoked") {
      res.status(400).json({ error: "This voucher has been revoked." });
      return;
    }

    if (voucher.status === "used") {
      res.status(400).json({ error: "This voucher has already been used." });
      return;
    }

    if (
      voucher.status === "expired" ||
      (voucher.expiresAt !== null && voucher.expiresAt < new Date())
    ) {
      res.status(400).json({ error: "This voucher has expired." });
      return;
    }

    // ── Device limit check ──────────────────────────────────────────────────
    // Count distinct MACs that have ever used this voucher.
    // If the current MAC is already one of them, allow reconnect.
    const deviceLimit = voucher.deviceLimit ?? 1;
    if (mac) {
      const usedBy = await db
        .selectDistinct({ mac: wifiSessions.macAddress })
        .from(wifiSessions)
        .where(eq(wifiSessions.voucherId, voucher.id));

      const knownMacs = new Set(usedBy.map((r) => r.mac).filter(Boolean));

      if (!knownMacs.has(mac) && knownMacs.size >= deviceLimit) {
        res.status(403).json({
          error: `This voucher is limited to ${deviceLimit} device${deviceLimit === 1 ? "" : "s"} and all slots are taken.`,
        });
        return;
      }
    }

    // ── Activate voucher on first use ───────────────────────────────────────
    // The voucher becomes `pending_activation` here and is only promoted to `active`
    // once the router confirms the hotspot user exists (further down). Flipping it to
    // `active` up front is what let the UI claim success while the router had granted
    // nothing — the "connected but no internet" bug.
    const now = new Date();
    const isFirstUse = voucher.status === "unused";
    // A retry after a failed router sync arrives as `pending_activation` — it still
    // needs promoting once the router finally confirms.
    const needsPromotion = isFirstUse || voucher.status === "pending_activation";

    if (isFirstUse) {
      let expiresAt = voucher.expiresAt; // keep existing batch expiry if set

      if (voucher.durationMinutes) {
        const durationExpiry = new Date(now.getTime() + minutesToMs(voucher.durationMinutes));
        // Use whichever deadline comes first: batch expiry or duration expiry
        expiresAt = expiresAt
          ? new Date(Math.min(expiresAt.getTime(), durationExpiry.getTime()))
          : durationExpiry;
      }

      await db
        .update(vouchers)
        .set({ status: "pending_activation", activatedAt: now, expiresAt })
        .where(eq(vouchers.id, voucher.id));
    }

    // ── Record customer + session ───────────────────────────────────────────
    if (mac) {
      // Upsert customer by MAC address
      await db
        .insert(wifiCustomers)
        .values({
          macAddress: mac,
          lastIpAddress: ip || null,
          lastActiveAt: now,
          deviceType,
          deviceName,
        })
        .onDuplicateKeyUpdate({
          set: { lastIpAddress: ip || null, lastActiveAt: now, deviceType, deviceName },
        });

      const [customer] = await db
        .select({ id: wifiCustomers.id })
        .from(wifiCustomers)
        .where(eq(wifiCustomers.macAddress, mac))
        .limit(1);

      if (customer) {
        await db.insert(wifiSessions).values({
          customerId: customer.id,
          voucherId: voucher.id,
          packageId: voucher.packageId ?? null,
          venueId: voucher.venueId ?? null,
          macAddress: mac,
          ipAddress: ip || null,
          status: "connected",
          deviceType,
          deviceName,
        });
      }
    }

    // Ensure the hotspot user exists on MikroTik — guards against vouchers that were
    // never synced due to RouterSync failures at batch-creation time.
    // If the voucher has no venueId (PMT payment where IP lookup failed), fall back to
    // resolving the venue from the linkLogin URL sent by the portal.
    let jitVenueId = voucher.venueId;
    if (!jitVenueId && linkLogin) {
      try {
        const routerIp = new URL(linkLogin).hostname;
        const [r] = await db
          .select({ venueId: routers.venueId })
          .from(routers)
          .where(or(eq(routers.ipAddress, routerIp), eq(routers.hotspotGatewayIp, routerIp)))
          .limit(1);
        if (r?.venueId) {
          jitVenueId = r.venueId;
          // Backfill so future syncs and expiry daemon work correctly
          await db.update(vouchers).set({ venueId: jitVenueId }).where(eq(vouchers.id, voucher.id));
        }
      } catch {
        /* ignore malformed URL */
      }
    }

    // ── The router must confirm before we report success ────────────────────
    // Previously this raced a 3s timer and returned ok:true regardless of outcome.
    // Now we await the real result: no confirmation, no success response.
    if (jitVenueId) {
      let outcome;
      try {
        outcome = await ensureVoucherOnVenueRouters(jitVenueId, raw);
      } catch (err) {
        console.error("[validate-voucher] MikroTik JIT sync error:", (err as Error).message);
        res.status(503).json({
          error:
            "Could not reach the WiFi router to activate your voucher. " +
            "Please try again in a moment.",
          code: "ROUTER_UNREACHABLE",
        });
        return;
      }

      if (!outcomeOk(outcome)) {
        console.error(
          `[validate-voucher] Router did not confirm voucher "${raw}": ${describeFailures(outcome)}`,
        );
        res.status(503).json({
          error:
            "Your voucher is valid, but the WiFi router has not activated it yet. " +
            "Please try again in a moment.",
          code: "ROUTER_NOT_CONFIRMED",
        });
        return;
      }
    }

    // Router confirmed — safe to mark the voucher usable.
    if (needsPromotion) {
      await db.update(vouchers).set({ status: "active" }).where(eq(vouchers.id, voucher.id));
    }

    res.json({ ok: true, username: raw, password: raw });
  }),
);

// ─── POST /portal/initiate-payment ──────────────────────────────────────────
// Creates a Snippe mobile money payment for the selected package.
// Returns { paymentId, reference, expiresAt, amount } on success.
captivePortalRouter.post(
  "/initiate-payment",
  asyncRoute(async (req, res) => {
    const { packageId, phone, mac, ip, linkLogin, venueId: bodyVenueId } = req.body ?? {};

    const normalizedPhone = normalizeTzPhone(typeof phone === "string" ? phone : "");
    if (!normalizedPhone) {
      res.status(400).json({ error: "Invalid mobile number. Use format +255 XXX XXX XXX." });
      return;
    }
    if (!packageId || typeof packageId !== "string") {
      res.status(400).json({ error: "Package is required." });
      return;
    }

    const [pkg] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.id, packageId), eq(packages.isActive, true)))
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: "Package not found." });
      return;
    }

    const amountTsh = Math.round(Number(pkg.priceTsh));
    if (amountTsh < 1000) {
      res
        .status(400)
        .json({ error: "Package price is below the minimum payment amount (TSh 1,000)." });
      return;
    }

    // Use the venueId pre-resolved at page render time (most reliable).
    // Fall back to resolving from linkLogin IP if not provided (older clients).
    let venueId: string | null =
      typeof bodyVenueId === "string" && bodyVenueId ? bodyVenueId : null;
    if (!venueId && typeof linkLogin === "string" && linkLogin) {
      try {
        const routerIp = new URL(linkLogin).hostname;
        const [router] = await db
          .select({ venueId: routers.venueId })
          .from(routers)
          .where(or(eq(routers.ipAddress, routerIp), eq(routers.hotspotGatewayIp, routerIp)))
          .limit(1);
        if (router) venueId = router.venueId;
      } catch {
        /* ignore malformed URL */
      }
    }

    const paymentId = randomUUID();
    await db.insert(payments).values({
      id: paymentId,
      packageId: pkg.id,
      venueId,
      provider: "mpesa",
      phone: normalizedPhone,
      amountTsh: String(amountTsh),
      status: "pending",
      metadata: {
        mac: typeof mac === "string" ? mac : null,
        ip: typeof ip === "string" ? ip : null,
        linkLogin: typeof linkLogin === "string" ? linkLogin : null,
      },
    });

    const apiKey = process.env.SNIPPE_API_KEY;
    const appUrl = process.env.APP_URL ?? "";

    if (!apiKey) {
      await db.update(payments).set({ status: "cancelled" }).where(eq(payments.id, paymentId));
      res.status(503).json({ error: "Payment service is not configured." });
      return;
    }

    const idempotencyKey = paymentId.slice(0, 30);
    const customerEmail = `${normalizedPhone.replace("+", "")}@wifi.customer`;

    let snippeResponse: { reference: string; expires_at: string };
    try {
      const snippeRes = await fetch("https://api.snippe.sh/v1/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          payment_type: "mobile",
          details: { amount: amountTsh, currency: "TZS" },
          phone_number: normalizedPhone,
          customer: { firstname: "WiFi", lastname: "Customer", email: customerEmail },
          webhook_url: appUrl ? `${appUrl}/webhooks/snippe` : undefined,
          metadata: { payment_id: paymentId, package_id: pkg.id },
        }),
      });

      const body = (await snippeRes.json()) as {
        status: string;
        data?: { reference: string; expires_at: string };
        message?: string;
      };

      if (!snippeRes.ok || !body.data) {
        const msg = body.message ?? "Payment provider error";
        await db
          .update(payments)
          .set({ status: "cancelled", metadata: { error: msg } })
          .where(eq(payments.id, paymentId));
        res.status(502).json({ error: msg });
        return;
      }

      snippeResponse = body.data;
    } catch {
      await db.update(payments).set({ status: "cancelled" }).where(eq(payments.id, paymentId));
      res.status(503).json({ error: "Failed to reach payment provider. Please try again." });
      return;
    }

    await db
      .update(payments)
      .set({ providerReference: snippeResponse.reference })
      .where(eq(payments.id, paymentId));

    res.json({
      paymentId,
      reference: snippeResponse.reference,
      expiresAt: snippeResponse.expires_at,
      amount: amountTsh,
    });
  }),
);

// ─── GET /portal/payment-status/:paymentId ───────────────────────────────────
// Returns current payment status. If still pending and providerReference exists,
// polls Snippe directly as a fallback (covers local dev without a public webhook URL).
captivePortalRouter.get(
  "/payment-status/:paymentId",
  asyncRoute(async (req, res) => {
    const paymentId = req.params.paymentId as string;
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);

    if (!payment) {
      res.status(404).json({ error: "Payment not found." });
      return;
    }

    if (payment.status === "paid") {
      const meta = (payment.metadata ?? {}) as Record<string, unknown>;
      // `routerProvisioned` is what the portal must wait on — "paid" only means the
      // money arrived, not that the router will let this device online.
      res.json({
        status: "paid",
        voucherCode: meta.voucherCode,
        routerProvisioned: payment.routerProvisionedAt !== null,
        provisionError: payment.provisionError ?? null,
      });
      return;
    }

    if (payment.status === "failed" || payment.status === "cancelled") {
      res.json({ status: "failed" });
      return;
    }

    // Still pending — check Snippe directly (fallback when webhook URL is not public)
    if (payment.providerReference && process.env.SNIPPE_API_KEY) {
      try {
        const snippeRes = await fetch(
          `https://api.snippe.sh/v1/payments/${payment.providerReference}`,
          { headers: { Authorization: `Bearer ${process.env.SNIPPE_API_KEY}` } },
        );
        const body = (await snippeRes.json()) as {
          data?: { status: string; reference: string; failure_reason?: string };
        };

        if (snippeRes.ok && body.data?.status === "completed") {
          await processPaymentCompleted(payment, `poll-${payment.providerReference}`);
          // Re-fetch to get the voucher code written to metadata
          const [updated] = await db
            .select()
            .from(payments)
            .where(eq(payments.id, payment.id))
            .limit(1);
          const meta = (updated?.metadata ?? {}) as Record<string, unknown>;
          res.json({ status: "paid", voucherCode: meta.voucherCode });
          return;
        }

        // "cancelled" is what Snippe reports when the authorisation window lapses —
        // omitting it left payments pending forever and the portal spinning.
        if (
          snippeRes.ok &&
          body.data &&
          SNIPPE_TERMINAL_FAILURE_STATUSES.includes(body.data.status)
        ) {
          await markPaymentFailed(
            payment,
            `poll:${body.data.status}`,
            body.data.failure_reason ?? null,
          );
          res.json({ status: "failed" });
          return;
        }
      } catch {
        /* ignore — fall through to pending */
      }
    }

    res.json({ status: "pending" });
  }),
);

// ─── GET /portal/session-status ─────────────────────────────────────────────
// Called by alogin.html to check whether the user's voucher is still active.
// Returns { active: true } when a valid, non-expired session exists for the MAC.
captivePortalRouter.get(
  "/session-status",
  asyncRoute(async (req, res) => {
    const mac = typeof req.query.mac === "string" ? req.query.mac.trim() : "";
    if (!mac) {
      res.json({ active: false });
      return;
    }

    const now = new Date();

    const [row] = await db
      .select({
        id: vouchers.id,
        expiresAt: vouchers.expiresAt,
        dataLimitGb: vouchers.dataLimitGb,
      })
      .from(wifiSessions)
      .innerJoin(vouchers, eq(wifiSessions.voucherId, vouchers.id))
      .where(
        and(
          eq(wifiSessions.macAddress, mac),
          eq(vouchers.status, "active"),
          or(isNull(vouchers.expiresAt), gt(vouchers.expiresAt, now)),
        ),
      )
      .limit(1);

    if (!row) {
      res.json({ active: false });
      return;
    }

    // Usage is summed across every session on this voucher, not read from
    // `vouchers.data_used_bytes` — that column exists but nothing writes to it, so it
    // would always report zero. live-monitor syncs per-session counters from the router.
    const [usage] = await db
      .select({
        totalBytes: sql<number>`COALESCE(SUM(${wifiSessions.uploadBytes} + ${wifiSessions.downloadBytes}), 0)`,
      })
      .from(wifiSessions)
      .where(eq(wifiSessions.voucherId, row.id));

    // -1 or null means unlimited (see "Database Conventions" in CLAUDE.md).
    const dataUnlimited = row.dataLimitGb === null || row.dataLimitGb < 0;
    const limitBytes = dataUnlimited ? null : row.dataLimitGb! * 1_073_741_824;
    const usedBytes = Number(usage?.totalBytes ?? 0);

    // Wall-clock remaining. The router separately enforces `limit-uptime` (accumulated
    // online time), which only diverges if the user disconnects and returns — and always
    // in their favour, since wall-clock elapses faster. Showing wall-clock therefore
    // never promises more time than they actually have.
    const timeUnlimited = row.expiresAt === null;
    const secondsRemaining = timeUnlimited
      ? null
      : Math.max(0, Math.floor((row.expiresAt!.getTime() - now.getTime()) / 1000));

    // Deliberately does NOT return the voucher code: the code doubles as the hotspot
    // password, and this endpoint is public and keyed only by a spoofable MAC.
    res.json({
      active: true,
      time: {
        unlimited: timeUnlimited,
        secondsRemaining,
        expiresAt: row.expiresAt?.toISOString() ?? null,
      },
      data: {
        unlimited: dataUnlimited,
        usedBytes,
        limitBytes,
        remainingBytes: limitBytes === null ? null : Math.max(0, limitBytes - usedBytes),
      },
    });
  }),
);

// ─── HTML templates ──────────────────────────────────────────────────────────

type Settings = typeof portalSettings.$inferSelect;
type Package = typeof packages.$inferSelect;

interface AutoReconnectData {
  code: string;
  linkLogin: string;
  linkOrig: string;
  primary: string;
  bg: string;
  brandName: string;
}

function renderAutoReconnect(d: AutoReconnectData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reconnecting…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#f4efe9;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:20px;color:#1a0f0b}
    .brand{display:flex;align-items:center;gap:9px}
    .brand-icon{width:32px;height:32px;background:${esc(d.primary)};border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .brand-name{font-size:15px;font-weight:600;color:#1a0f0b;letter-spacing:-.015em}
    .card{background:#fff;border:1px solid #e8dcd5;border-radius:18px;padding:40px 32px 36px;max-width:380px;width:100%;display:flex;flex-direction:column;align-items:center;text-align:center;box-shadow:0 1px 4px rgba(26,15,11,.05),0 4px 20px rgba(26,15,11,.06)}
    .ring{width:52px;height:52px;border:3px solid rgba(0,0,0,.08);border-top-color:${esc(d.primary)};border-radius:50%;animation:spin .8s linear infinite;margin-bottom:22px}
    @keyframes spin{to{transform:rotate(360deg)}}
    .icon-wrap{width:64px;height:64px;position:relative;margin-bottom:22px;display:none}
    .icon-bg{position:absolute;inset:0;border-radius:50%;background:${esc(d.primary)}14;border:1px solid ${esc(d.primary)}38}
    .icon-check{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
    .heading{font-size:20px;font-weight:700;color:#1a0f0b;letter-spacing:-.03em;margin-bottom:8px}
    .msg{font-size:14px;color:#7a6860;line-height:1.65}
    .footer{font-size:11.5px;color:#c4b0a8;letter-spacing:.02em}
  </style>
</head>
<body>
  <div class="brand">
    <div class="brand-icon">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
        <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <circle cx="12" cy="20" r="1" fill="#fff" stroke="none"/>
      </svg>
    </div>
    <span class="brand-name">${esc(d.brandName)}</span>
  </div>
  <div class="card">
    <div class="ring" id="spinner"></div>
    <div class="icon-wrap" id="ico">
      <div class="icon-bg"></div>
      <div class="icon-check">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${esc(d.primary)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
    </div>
    <div class="heading" id="title">Reconnecting…</div>
    <div class="msg" id="msg">You have an active plan —<br>no need to sign in again.</div>
  </div>
  <div class="footer">WiFi Billing System</div>
  <form id="f" method="POST" action="${esc(d.linkLogin)}" style="display:none">
    <input name="username" value="${esc(d.code)}">
    <input name="password" value="${esc(d.code)}">
    <input name="dst"      value="${esc(d.linkOrig || "http://google.com")}">
  </form>
  <script>
    window.onload = function() {
      document.getElementById("f").submit();
      // MikroTik redirects the browser on success — if we're still here after 2.5s,
      // show a success state so the user isn't stuck staring at a spinner.
      setTimeout(function() {
        document.getElementById("spinner").style.display = "none";
        document.getElementById("ico").style.display = "block";
        document.getElementById("title").textContent = "You're connected";
        document.getElementById("msg").textContent = "Close this window and start browsing.";
      }, 2500);
    };
  </script>
</body>
</html>`;
}

interface PageData {
  settings: Settings | null;
  packages: Package[];
  fromMikrotik: boolean;
  mac: string;
  ip: string;
  linkLogin: string;
  linkOrig: string;
  chapId: string;
  chapChallenge: string;
  prefilledCode: string;
  venueId: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPortalPage(d: PageData): string {
  const s = d.settings;
  const primary = s?.primaryColor ?? "#3b82f6";
  const accent = s?.accentColor ?? "#f59e0b";
  const bg = s?.backgroundColor ?? "#1e3a5f";
  const bgStyle = s?.backgroundStyle ?? "soft";
  const logoUrl = s?.logoUrl ?? "";
  const bgImgUrl = s?.backgroundImageUrl ?? "";
  const r = s?.radius ?? 18;
  const sheetR = Math.min(r + 6, 28);
  const btnR = Math.min(Math.round(r / 1.5), 14);
  const logoR = Math.round(r / 2);
  const brandName = esc(s?.brandName ?? "WiFi Portal");
  const logoText = esc(s?.logoText ?? "W");
  const headline = esc(s?.headline ?? "Connect to the Internet");
  const message = esc(s?.message ?? "Enter your voucher code or purchase a package.");
  const voucherLabel = esc(s?.voucherLabel ?? "Voucher Code");
  const voucherHelp = esc(s?.voucherHelp ?? "Enter the code printed on your voucher card.");
  const requireTerms = s?.requireTerms ?? false;

  // ── Background CSS ─────────────────────────────────────────────────────────
  let bodyBg: string;
  if (bgImgUrl) {
    bodyBg = `background-image:url('${esc(bgImgUrl)}');background-size:cover;background-position:center;background-attachment:fixed`;
  } else if (bgStyle === "solid") {
    bodyBg = `background:${bg}`;
  } else if (bgStyle === "split") {
    bodyBg = `background:linear-gradient(150deg,${bg} 0%,${bg} 52%,${primary} 52%,${accent} 100%)`;
  } else {
    // soft (default) — matches the admin preview's radial-gradient
    bodyBg = `background:radial-gradient(circle at top left,${primary}55,transparent 35%),radial-gradient(circle at bottom right,${accent}55,transparent 38%),${bg}`;
  }

  // ── "Not on WiFi" screen ───────────────────────────────────────────────────
  if (!d.fromMikrotik && !d.prefilledCode) {
    const logoEl = logoUrl
      ? `<img src="${esc(logoUrl)}" alt="${brandName}" style="width:60px;height:60px;object-fit:cover;border-radius:${logoR}px;margin:0 auto 18px;display:block">`
      : `<div style="width:64px;height:64px;border-radius:${logoR}px;background:${bg};color:white;font-size:26px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 18px">${logoText}</div>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>${brandName} — WiFi Portal</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:white;border-radius:20px;padding:36px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    h1{font-size:19px;font-weight:700;color:#18181b;margin-bottom:8px}
    p{font-size:13px;color:#71717a;line-height:1.6;margin-bottom:20px}
    .steps{text-align:left;display:flex;flex-direction:column;gap:8px}
    .step{background:#f4f4f5;border-radius:12px;padding:11px 14px}
    .step-n{font-size:10px;font-weight:700;color:${primary};text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}
    .step-t{font-size:12px;color:#3f3f46;font-weight:500}
  </style>
</head>
<body>
  <div class="card">
    ${logoEl}
    <h1>Connect to WiFi First</h1>
    <p>You need to be connected to the <strong>${brandName}</strong> WiFi network before you can access this page.</p>
    <div class="steps">
      <div class="step"><div class="step-n">Step 1</div><div class="step-t">Connect to the WiFi network</div></div>
      <div class="step"><div class="step-n">Step 2</div><div class="step-t">Open your browser — this page appears automatically</div></div>
      <div class="step"><div class="step-n">Step 3</div><div class="step-t">Enter your voucher code or purchase a package</div></div>
    </div>
  </div>
</body>
</html>`;
  }

  // ── Package bucketing ──────────────────────────────────────────────────────
  // Ranges live in DURATION_BUCKETS so this and the admin's Phone Preview cannot drift.
  // Sub-hour bundles get their own "Minutes" tab — they used to fall under "Hourly", which
  // is half of why a 3-minute package read as three hours.
  const bucketDefs = DURATION_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    pkgs: d.packages.filter(
      (p) => p.durationMinutes >= b.min && p.durationMinutes < b.max,
    ),
  })).filter((b) => b.pkgs.length > 0);

  const firstBucketKey = bucketDefs[0]?.key ?? "";

  function pkgCardHtml(pkg: Package, isPopular: boolean): string {
    const price = Number(pkg.priceTsh).toLocaleString();
    const durShort = durationShort(pkg.durationMinutes);
    // Spelled out on the feature bullet: "30 minutes browsing" beats "30m browsing" for a
    // customer choosing a bundle, and the old `${hours}h` would have rendered "30h".
    const durFull = `${formatDuration(pkg.durationMinutes)} browsing`;
    const dataStr =
      pkg.dataLimitGb === -1 || pkg.dataLimitGb === null
        ? "Unlimited data"
        : `${pkg.dataLimitGb} GB data`;
    const features = [
      durFull,
      `${pkg.downloadSpeedMbps} Mbps speed`,
      dataStr,
      "Instant activation",
    ];
    const featHtml = features
      .map(
        (f) =>
          `<li style="font-size:13px;color:#71717a;display:flex;align-items:center;gap:6px"><span style="color:${primary};font-weight:700;font-size:13px;flex-shrink:0">✓</span>${esc(f)}</li>`,
      )
      .join("");

    const popularBadge = isPopular
      ? `<span style="position:absolute;top:0;right:14px;background:${primary};color:white;font-size:10px;font-weight:800;letter-spacing:.06em;padding:3px 10px;border-radius:0 0 8px 8px;text-transform:uppercase;pointer-events:none">Most Popular</span>`
      : "";

    return `<div class="pkg-card" data-id="${esc(pkg.id)}" data-price="${esc(String(pkg.priceTsh))}" data-name="${esc(pkg.name)}" data-dur="${durShort}" data-speed="${pkg.downloadSpeedMbps}" data-data="${esc(dataStr)}" data-dur-full="${esc(durFull)}" style="position:relative;background:white;border-radius:16px;border:1.5px solid #d4d4d8;box-shadow:0 1px 4px rgba(0,0,0,.07);margin-bottom:14px">
  ${popularBadge}
  <div style="padding:16px">
    <p style="font-size:20px;font-weight:900;color:#18181b;margin-bottom:6px;letter-spacing:-.02em;line-height:1.2">${esc(pkg.name)}</p>
    <div style="display:flex;align-items:baseline;gap:3px;margin-bottom:12px">
      <span style="font-size:12px;color:#a1a1aa;font-weight:500">TSh</span>
      <span style="font-size:28px;font-weight:900;line-height:1;color:#18181b">${price}</span>
      <span style="font-size:12px;color:#a1a1aa"> / ${durShort}</span>
    </div>
    <ul style="list-style:none;margin-bottom:14px;display:flex;flex-direction:column;gap:6px">${featHtml}</ul>
    <button onclick="selectPkg(this)" style="width:100%;padding:13px;border-radius:10px;border:1.5px solid #d4d4d8;font-size:14px;font-weight:700;cursor:pointer;background:#f4f4f5;color:#3f3f46">→ Subscribe for TSh ${price}</button>
  </div>
</div>`;
  }

  const bucketsHtml =
    bucketDefs.length === 0
      ? `<div style="background:white;border-radius:16px;border:1px dashed #d4d4d8;padding:40px 16px;text-align:center"><p style="font-size:14px;color:#a1a1aa">No packages available right now.</p></div>`
      : bucketDefs
          .map((b) => {
            const popularIdx = b.pkgs.length > 1 ? Math.floor(b.pkgs.length / 2) : -1;
            const cardsHtml = b.pkgs.map((p, i) => pkgCardHtml(p, i === popularIdx)).join("\n");
            return `<div id="bucket-${b.key}" style="display:${b.key === firstBucketKey ? "block" : "none"}">${cardsHtml}</div>`;
          })
          .join("\n");

  const pillsHtml =
    bucketDefs.length > 1
      ? `<div id="pills" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:6px;-webkit-overflow-scrolling:touch;scrollbar-width:none">
        ${bucketDefs.map((b) => `<button id="pill-${b.key}" onclick="filterPkgs('${b.key}')" style="${b.key === firstBucketKey ? `background:${primary};color:white` : "background:#f4f4f5;color:#71717a"};flex-shrink:0;border:none;border-radius:999px;padding:7px 16px;font-size:13px;font-weight:700;cursor:pointer">${b.label}</button>`).join("")}
      </div>`
      : "";

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${brandName}" style="width:36px;height:36px;object-fit:cover;border-radius:${logoR}px;flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,.2)">`
    : `<div style="width:36px;height:36px;border-radius:${logoR}px;background:${primary};color:white;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${logoText}</div>`;

  const termsHtml = requireTerms
    ? `<p style="font-size:12px;color:#a1a1aa;text-align:center;margin-top:14px;line-height:1.6">By connecting you agree to our <span style="color:${primary};text-decoration:underline">Terms of Service</span></p>`
    : "";

  const bucketKeys = bucketDefs.map((b) => b.key);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${brandName} — WiFi</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html{min-height:100%}
    body{min-height:100vh;min-height:100dvh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;${bodyBg};display:flex;flex-direction:column;overscroll-behavior-y:contain}
    .hdr{padding:24px 20px 20px;flex-shrink:0}
    .hdr-brand{display:flex;align-items:center;gap:10px;margin-bottom:16px}
    .bname{font-size:16px;font-weight:700;color:white}
    .btag{font-size:12px;color:rgba(255,255,255,.5);margin-top:1px}
    h2{font-size:24px;font-weight:700;color:white;margin-bottom:6px;letter-spacing:-.02em}
    .sub{font-size:13px;color:rgba(255,255,255,.6);line-height:1.6}
    .sheet{background:#f4f4f5;border-radius:${sheetR}px ${sheetR}px 0 0;flex:1;padding:16px 16px 80px}
    .tabs{display:flex;background:white;border-radius:12px;padding:4px;gap:4px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    .live-pass{background:white;border-radius:12px;padding:14px 16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);border-left:3px solid #16a34a}
    .live-pass-row{display:flex;align-items:center;gap:8px}
    .live-pass-dot{width:8px;height:8px;border-radius:50%;background:#16a34a;flex:none}
    .live-pass-title{font-size:14px;font-weight:700;color:#18181b}
    .live-pass-meta{margin-top:6px;font-size:13px;color:#71717a;font-variant-numeric:tabular-nums}
    .tab{flex:1;padding:10px;border-radius:9px;border:none;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s}
    .tab svg{width:15px;height:15px;flex-shrink:0}
    .pane{display:none}.pane.on{display:block}
    label{font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:7px}
    input{width:100%;padding:14px 16px;border:1.5px solid #e4e4e7;border-radius:${btnR}px;font-size:16px;color:#18181b;background:white;outline:none;-webkit-appearance:none;transition:border-color .15s}
    input:focus{border-color:${primary}}
    input.mono{font-family:ui-monospace,"SF Mono","Fira Code",monospace;letter-spacing:.08em;font-size:16px;text-transform:uppercase}
    input::placeholder{color:#a1a1aa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:0;text-transform:none}
    .ig{margin-bottom:14px}
    .btn{width:100%;padding:15px;border-radius:${btnR}px;border:none;font-size:15px;font-weight:700;cursor:pointer;margin-top:12px}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .err{background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:10px;padding:11px 14px;font-size:13px;margin-bottom:12px;display:none}
    .err.on{display:block}
    .ok-card{background:white;border-radius:16px;padding:32px 20px;text-align:center;display:none}
    .ok-card.on{display:block}
    .ok-ico{width:56px;height:56px;border-radius:50%;background:#dcfce7;color:#16a34a;font-size:24px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
    .ok-t{font-size:19px;font-weight:700;color:#18181b;margin-bottom:6px;letter-spacing:-.02em}
    .ok-s{font-size:13px;color:#71717a;line-height:1.6}
    .spin{display:inline-block;width:15px;height:15px;border:2px solid rgba(255,255,255,.4);border-top-color:white;border-radius:50%;animation:sp .7s linear infinite;vertical-align:middle;margin-right:6px}
    @keyframes sp{to{transform:rotate(360deg)}}
    #pills::-webkit-scrollbar{display:none}
  </style>
</head>
<body>

<!-- Header — shows brand + headline over the background -->
<div class="hdr">
  <div class="hdr-brand">
    ${logoHtml}
    <div>
      <div class="bname">${brandName}</div>
      <div class="btag">Secure WiFi Hotspot</div>
    </div>
  </div>
  <h2>${headline}</h2>
  <p class="sub">${message}</p>
</div>

<!-- White bottom sheet -->
<div class="sheet">

  <!-- Shown only when this device already has a live session. Without it, someone who
       is already online sees a bare login form and may buy a second pass they
       don't need. Populated by refreshLivePass() below. -->
  <div class="live-pass" id="live-pass" style="display:none">
    <div class="live-pass-row">
      <span class="live-pass-dot"></span>
      <span class="live-pass-title">You're already connected</span>
    </div>
    <div class="live-pass-meta" id="live-pass-meta"></div>
  </div>

  <!-- Tab bar -->
  <div class="tabs">
    <button id="tab-o" class="tab" onclick="switchTab('o',this)" style="background:white;color:${primary};box-shadow:0 1px 3px rgba(0,0,0,.12)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
      Online Access
    </button>
    <button id="tab-v" class="tab" onclick="switchTab('v',this)" style="background:none;color:#a1a1aa">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
      Voucher
    </button>
  </div>

  <!-- Online Access pane (packages + payment) -->
  <div id="pane-o" class="pane on">
    <div id="pkg-section">
      ${pillsHtml}
      <div id="pkg-buckets">${bucketsHtml}</div>
    </div>
    <!-- Payment step — revealed when a package is selected -->
    <div id="pay-form" style="display:none">
      <div id="pay-summary" style="border-radius:12px;padding:14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between"></div>
      <!-- Step 1: phone input -->
      <div id="pay-step-input">
        <div class="ig">
          <label>Mobile Number</label>
          <div id="phone-wrap" style="display:flex;align-items:stretch;border:1.5px solid #e4e4e7;border-radius:${btnR}px;background:white;overflow:hidden;transition:border-color .15s">
            <span style="padding:14px 14px 14px 16px;background:#f4f4f5;color:#71717a;font-size:15px;font-weight:700;border-right:1.5px solid #e4e4e7;flex-shrink:0;display:flex;align-items:center;user-select:none;letter-spacing:.03em">+255</span>
            <input id="phone-local" type="tel" inputmode="numeric" maxlength="9" placeholder="7XX XXX XXX" autocomplete="tel" style="flex:1;border:none;padding:14px 12px;font-size:16px;color:#18181b;outline:none;background:white;min-width:0;-webkit-appearance:none" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,9)" onfocus="phoneWrapFocus(true)" onblur="phoneWrapFocus(false)">
          </div>
          <p style="font-size:12px;color:#a1a1aa;margin-top:6px">9 digits · must start with 6 or 7</p>
        </div>
        <div id="pay-err" class="err"></div>
        <button id="pay-btn" class="btn" style="background:${primary};color:white" onclick="submitPayment()">Pay via Mobile Money</button>
        <p style="font-size:13px;color:#a1a1aa;text-align:center;margin-top:12px;line-height:1.6">A USSD prompt will be sent to your phone to confirm payment.</p>
      </div>
      <!-- Step 2: waiting for payment confirmation -->
      <div id="pay-step-waiting" style="display:none;text-align:center;padding:20px 0">
        <div style="width:40px;height:40px;border:3px solid rgba(0,0,0,.08);border-top-color:${primary};border-radius:50%;animation:sp .7s linear infinite;margin:0 auto 14px"></div>
        <p style="font-size:16px;font-weight:700;color:#18181b">Waiting for payment</p>
        <p style="font-size:13px;color:#71717a;margin-top:8px;line-height:1.6">Check your phone for a payment prompt.<br>Enter your PIN to confirm.</p>
        <div id="pay-countdown" style="font-size:13px;color:#a1a1aa;margin-top:8px"></div>
        <div id="pay-waiting-err" class="err" style="margin-top:10px"></div>
        <button onclick="cancelPayment()" style="margin-top:14px;border:1px solid #e4e4e7;background:white;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;color:#71717a;cursor:pointer">Cancel &amp; Try Again</button>
      </div>
      <!-- Step 3: confirmed, connecting -->
      <div id="pay-step-connecting" style="display:none;text-align:center;padding:20px 0">
        <div style="width:44px;height:44px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:20px">✓</div>
        <p style="font-size:16px;font-weight:700;color:#16a34a">Payment confirmed!</p>
        <p style="font-size:13px;color:#71717a;margin-top:8px">Connecting you to WiFi…</p>
        <div style="width:28px;height:28px;border:2px solid rgba(0,0,0,.08);border-top-color:${primary};border-radius:50%;animation:sp .7s linear infinite;margin:12px auto 0"></div>
      </div>
    </div>
  </div>

  <!-- Voucher pane -->
  <div id="pane-v" class="pane">
    <div id="v-err" class="err"></div>
    <div id="v-ok" class="ok-card">
      <div class="ok-ico">✓</div>
      <div class="ok-t">You're connected!</div>
      <div class="ok-s">Close this window and start browsing.</div>
    </div>
    <div id="v-form">
      <div class="ig">
        <label style="color:${primary}">${voucherLabel}</label>
        <input id="code" type="text" class="mono" placeholder="WIFI-XXXX-XXXX" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" value="${esc(d.prefilledCode)}" oninput="this.value=this.value.toUpperCase()">
      </div>
      <p style="font-size:12px;color:#71717a;margin-bottom:2px;line-height:1.5">${voucherHelp}</p>
      <button id="conn-btn" class="btn" style="background:${primary};color:white" onclick="submitVoucher()">Connect to WiFi</button>
    </div>
  </div>

  ${termsHtml}
</div>

<!-- Hidden MikroTik login form (submitted after successful voucher validation) -->
<form id="mt-form" method="POST" action="${esc(d.linkLogin)}" style="display:none">
  <input type="hidden" name="username" id="mt-user">
  <input type="hidden" name="password" id="mt-pass">
  <input type="hidden" name="dst" value="${esc(d.linkOrig || "http://google.com")}">
</form>

<script>
  function md5(s){var hc="0123456789abcdef";function rh(n){var j="",i=-1;while(++i<4)j+=hc.charAt((n>>(i*8+4))&0xF)+hc.charAt((n>>(i*8))&0xF);return j}function ad(x,y){var l=(x&0xFFFF)+(y&0xFFFF),m=(x>>16)+(y>>16)+(l>>16);return(m<<16)|(l&0xFFFF)}function rl(n,c){return(n<<c)|(n>>>(32-c))}function cm(q,a,b,x,s,t){return ad(rl(ad(ad(a,q),ad(x,t)),s),b)}function ff(a,b,c,d,x,s,t){return cm((b&c)|((~b)&d),a,b,x,s,t)}function gg(a,b,c,d,x,s,t){return cm((b&d)|(c&(~d)),a,b,x,s,t)}function hh(a,b,c,d,x,s,t){return cm(b^c^d,a,b,x,s,t)}function ii(a,b,c,d,x,s,t){return cm(c^(b|(~d)),a,b,x,s,t)}function sb(x){var i,nblk=((x.length+8)>>6)+1,blks=new Array(nblk*16);for(i=0;i<nblk*16;i++)blks[i]=0;for(i=0;i<x.length;i++)blks[i>>2]|=x.charCodeAt(i)<<((i%4)*8);blks[i>>2]|=0x80<<((i%4)*8);blks[nblk*16-2]=x.length*8;return blks}var i,x=sb(s),a=1732584193,b=-271733879,c=-1732584194,d=271733878,olda,oldb,oldc,oldd;for(i=0;i<x.length;i+=16){olda=a;oldb=b;oldc=c;oldd=d;a=ff(a,b,c,d,x[i],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i],20,-373897302);a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);a=hh(a,b,c,d,x[i+1],4,-1530992060);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,-155497632);b=hh(b,c,d,a,x[i+10],23,-1094730640);a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i],11,-358537222);c=hh(c,d,a,b,x[i+3],16,-722521979);b=hh(b,c,d,a,x[i+6],23,76029189);a=hh(a,b,c,d,x[i+9],4,-640364487);d=hh(d,a,b,c,x[i+12],11,-421815835);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,-995338651);a=ii(a,b,c,d,x[i],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);a=ad(a,olda);b=ad(b,oldb);c=ad(c,oldc);d=ad(d,oldd)}return rh(a)+rh(b)+rh(c)+rh(d)}

  var fromMikrotik  = ${d.fromMikrotik ? "true" : "false"};
  var primaryColor  = "${primary}";
  var accentColor   = "${accent}";
  var bucketKeys    = [${bucketKeys.map((k) => `"${k}"`).join(",")}];
  var pageMac       = "${esc(d.mac)}";
  var pageIp        = "${esc(d.ip)}";
  var pageLinkLogin = "${esc(d.linkLogin)}";
  var pageLinkOrig  = "${esc(d.linkOrig)}";
  var pageVenueId   = "${esc(d.venueId)}";
  var payPollTimer  = null;
  var payCountdownTimer = null;

  // ── Already-connected banner ───────────────────────────────────────────────
  // Same source of truth as alogin.html: the server decides, we only render.
  var livePassState = null; // { secondsRemaining, syncedAtMs } — null when unlimited/unknown
  var livePassData  = null; // last known data figures, or null

  function lpPad(n) { return n < 10 ? "0" + n : "" + n; }

  function lpDuration(total) {
    if (total < 0) total = 0;
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return h > 0 ? h + ":" + lpPad(m) + ":" + lpPad(s) : m + ":" + lpPad(s);
  }

  function lpBytes(bytes) {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  }

  // Time and data are capped independently. Each axis states "unlimited" explicitly
  // rather than being omitted — a blank is ambiguous between unlimited and not-loaded.
  var livePassTimeUnlimited = false;
  var livePassDataUnlimited = false;

  function renderLivePass() {
    var meta = document.getElementById("live-pass-meta");
    if (!meta) return;
    var parts = [];

    if (livePassState) {
      // Count from elapsed-since-sync, not the device clock against an absolute time.
      var left = livePassState.secondsRemaining -
                 Math.floor((Date.now() - livePassState.syncedAtMs) / 1000);
      if (left <= 0) {
        livePassState = null;
        refreshLivePass();   // never declare expiry client-side — ask the server
        return;
      }
      parts.push(lpDuration(left) + " remaining");
    } else if (livePassTimeUnlimited) {
      parts.push("No time limit");
    }

    if (livePassData) parts.push(lpBytes(livePassData.remainingBytes) + " of data left");
    else if (livePassDataUnlimited) parts.push("Unlimited data");

    meta.textContent = parts.length ? parts.join(" · ") : "Your pass is active";
  }

  var lpBusy = false;
  function refreshLivePass() {
    if (lpBusy || !pageMac) return;
    lpBusy = true;

    fetch("/portal/session-status?mac=" + encodeURIComponent(pageMac))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        lpBusy = false;
        var box = document.getElementById("live-pass");
        if (!box) return;

        if (!data.active) { box.style.display = "none"; livePassState = null; livePassData = null; return; }

        livePassTimeUnlimited = !!(data.time && data.time.unlimited);
        livePassDataUnlimited = !!(data.data && data.data.unlimited);

        livePassState = (data.time && !data.time.unlimited && data.time.secondsRemaining > 0)
          ? { secondsRemaining: data.time.secondsRemaining, syncedAtMs: Date.now() }
          : null;
        livePassData = (data.data && !data.data.unlimited && data.data.limitBytes) ? data.data : null;

        // Unlimited on both axes still deserves the banner — the point is "you're
        // already online", not just the numbers.
        box.style.display = "";
        renderLivePass();
      })
      .catch(function() { lpBusy = false; /* leave whatever is on screen */ });
  }

  refreshLivePass();
  setInterval(refreshLivePass, 30000);
  setInterval(renderLivePass, 1000);

  function switchTab(name, el) {
    document.querySelectorAll(".tab").forEach(function(t) {
      t.style.background = "none";
      t.style.color = "#a1a1aa";
      t.style.boxShadow = "none";
    });
    document.querySelectorAll(".pane").forEach(function(p) { p.classList.remove("on"); });
    var col = primaryColor;
    el.style.background = "white";
    el.style.color = col;
    el.style.boxShadow = "0 1px 3px rgba(0,0,0,.12)";
    document.getElementById("pane-" + name).classList.add("on");
  }

  function filterPkgs(key) {
    bucketKeys.forEach(function(k) {
      var el   = document.getElementById("bucket-" + k);
      var pill = document.getElementById("pill-"   + k);
      if (el)   el.style.display   = k === key ? "block" : "none";
      if (pill) {
        pill.style.background = k === key ? primaryColor : "#f4f4f5";
        pill.style.color      = k === key ? "white"      : "#71717a";
      }
    });
  }

  var selectedPkg = null;
  function selectPkg(btn) {
    var card = btn.closest ? btn.closest(".pkg-card") : btn.parentNode.parentNode;
    selectedPkg = {
      id: card.dataset.id,
      price: card.dataset.price,
      name: card.dataset.name,
      dur: card.dataset.dur,
      speed: card.dataset.speed,
      data: card.dataset.data,
      durFull: card.dataset.durFull
    };
    var price = Number(selectedPkg.price).toLocaleString();
    var feats = [selectedPkg.durFull, selectedPkg.speed + " Mbps speed", selectedPkg.data, "Instant activation"].filter(Boolean);
    var featsHtml = feats.map(function(f) {
      return "<li style='display:flex;align-items:center;gap:7px;font-size:13px;color:#71717a'>" +
             "<span style='color:" + primaryColor + ";font-weight:800;font-size:12px;flex-shrink:0'>✓</span>" + f + "</li>";
    }).join("");
    var sumEl = document.getElementById("pay-summary");
    sumEl.style.background = primaryColor + "15";
    sumEl.style.border = "1.5px solid " + primaryColor + "40";
    sumEl.style.borderRadius = "16px";
    sumEl.style.padding = "16px";
    sumEl.style.marginBottom = "14px";
    sumEl.style.display = "block";
    sumEl.innerHTML =
      "<div style='display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px'>" +
        "<p style='font-size:20px;font-weight:700;color:#18181b;line-height:1.1'>" + selectedPkg.name + "</p>" +
        "<button onclick='backToPkgs()' style='flex-shrink:0;border:1px solid #e4e4e7;background:white;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;color:#71717a;cursor:pointer'>Change</button>" +
      "</div>" +
      "<div style='display:flex;align-items:baseline;gap:3px;margin-bottom:14px'>" +
        "<span style='font-size:13px;color:#a1a1aa;font-weight:500'>TSh</span>" +
        "<span style='font-size:36px;font-weight:900;line-height:1;color:" + primaryColor + "'>" + price + "</span>" +
        "<span style='font-size:13px;color:#a1a1aa'> / " + selectedPkg.dur + "</span>" +
      "</div>" +
      "<ul style='list-style:none;display:flex;flex-direction:column;gap:7px'>" + featsHtml + "</ul>";
    document.getElementById("pkg-section").style.display = "none";
    document.getElementById("pay-form").style.display = "block";
  }

  function backToPkgs() {
    selectedPkg = null;
    document.getElementById("pay-form").style.display = "none";
    document.getElementById("pkg-section").style.display = "block";
  }

  async function submitVoucher() {
    var code = document.getElementById("code").value.trim();
    var btn  = document.getElementById("conn-btn");
    var err  = document.getElementById("v-err");
    err.classList.remove("on");
    if (!code) { showErr(err, "Please enter your voucher code."); return; }
    btn.disabled = true;
    btn.innerHTML = "<span class='spin'></span>Connecting…";
    try {
      var res  = await fetch("/portal/validate-voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code, mac: "${esc(d.mac)}", ip: "${esc(d.ip)}" }),
      });
      var data = await res.json();
      if (!res.ok) {
        showErr(err, data.error || "Something went wrong. Please try again.");
        btn.disabled = false;
        btn.innerHTML = "Connect to WiFi";
        return;
      }
      if (!fromMikrotik) {
        window.location.replace("http://neverssl.com/?code=" + encodeURIComponent(code));
        return;
      }
      document.getElementById("v-form").style.display = "none";
      document.getElementById("v-ok").classList.add("on");
      document.getElementById("mt-user").value = data.username;
      document.getElementById("mt-pass").value = data.password;
      setTimeout(function() { document.getElementById("mt-form").submit(); }, 1400);
    } catch(e) {
      showErr(err, "Network error. Please try again.");
      btn.disabled = false;
      btn.innerHTML = "Connect to WiFi";
    }
  }

  function showPayStep(step) {
    ["input","waiting","connecting"].forEach(function(s) {
      var el = document.getElementById("pay-step-" + s);
      if (el) el.style.display = s === step ? (s === "input" ? "block" : "block") : "none";
    });
  }

  function phoneWrapFocus(focused) {
    var wrap = document.getElementById("phone-wrap");
    if (wrap) wrap.style.borderColor = focused ? primaryColor : "#e4e4e7";
  }

  async function submitPayment() {
    var localPart = document.getElementById("phone-local").value.replace(/[^0-9]/g, "");
    var err   = document.getElementById("pay-err");
    err.classList.remove("on");
    if (!localPart) { showErr(err, "Please enter your mobile number."); return; }
    if (localPart.length !== 9) { showErr(err, "Please enter all 9 digits of your number."); return; }
    if (localPart[0] !== "6" && localPart[0] !== "7") { showErr(err, "Number must start with 6 or 7 (e.g. 712 345 678)."); return; }
    var phone = "+255" + localPart;
    if (!selectedPkg) return;
    var btn = document.getElementById("pay-btn");
    btn.disabled = true;
    btn.innerHTML = "<span class='spin'></span>Initiating payment…";
    try {
      var res  = await fetch("/portal/initiate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: selectedPkg.id, phone: phone, mac: pageMac, ip: pageIp, linkLogin: pageLinkLogin, venueId: pageVenueId }),
      });
      var data = await res.json();
      if (!res.ok) {
        showErr(err, data.error || "Failed to initiate payment. Please try again.");
        btn.disabled = false; btn.innerHTML = "Pay via Mobile Money";
        return;
      }
      startPaymentPolling(data.paymentId, data.expiresAt);
    } catch(e) {
      showErr(err, "Network error. Please try again.");
      btn.disabled = false; btn.innerHTML = "Pay via Mobile Money";
    }
  }

  function startPaymentPolling(paymentId, expiresAt) {
    showPayStep("waiting");
    clearInterval(payPollTimer);
    clearInterval(payCountdownTimer);
    var pollCount = 0;
    var expiry = new Date(expiresAt).getTime();
    if (isNaN(expiry)) expiry = Date.now() + 10 * 60 * 1000;
    // Poll for the whole authorisation window the gateway actually granted (10 min), not
    // an arbitrary 4 min — giving up early made a still-payable payment look timed out.
    // Capped so a bogus far-future expiry can't poll forever.
    var pollDeadline = Math.min(expiry + 20000, Date.now() + 15 * 60 * 1000);
    function updateCountdown() {
      var rem = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
      var cd  = document.getElementById("pay-countdown");
      if (cd) cd.textContent = rem > 0 ? "Expires in " + Math.floor(rem/60) + ":" + (rem%60 < 10 ? "0" : "") + rem%60 : "Expired";
    }
    updateCountdown();
    payCountdownTimer = setInterval(updateCountdown, 1000);
    payPollTimer = setInterval(async function() {
      pollCount++;
      if (Date.now() > pollDeadline) {
        clearInterval(payPollTimer); clearInterval(payCountdownTimer);
        var we = document.getElementById("pay-waiting-err");
        if (we) { we.textContent = "Payment timed out. Please try again."; we.classList.add("on"); }
        setTimeout(cancelPayment, 3000);
        return;
      }
      try {
        var r = await fetch("/portal/payment-status/" + paymentId);
        var d = await r.json();
        if (d.status === "paid") {
          // Paid is not enough — wait until the router has actually been given the
          // voucher, otherwise we send the user to a login form that will reject them.
          if (!d.routerProvisioned) {
            showPayStep("connecting");
            if (pollCount > 20 && d.provisionError) {
              clearInterval(payPollTimer); clearInterval(payCountdownTimer);
              var pe = document.getElementById("pay-waiting-err");
              showPayStep("waiting");
              if (pe) { pe.textContent = "Payment received, but the router could not be reached. Your voucher code is: " + d.voucherCode + " — enter it in the Voucher tab."; pe.classList.add("on"); }
            }
            return; // keep polling
          }
          clearInterval(payPollTimer); clearInterval(payCountdownTimer);
          handlePaymentConfirmed(d.voucherCode);
        } else if (d.status === "failed") {
          clearInterval(payPollTimer); clearInterval(payCountdownTimer);
          var we = document.getElementById("pay-waiting-err");
          if (we) { we.textContent = "Payment was not completed. Please try again."; we.classList.add("on"); }
          setTimeout(cancelPayment, 3000);
        }
      } catch(e) { /* keep polling on network error */ }
    }, 3000);
  }

  async function handlePaymentConfirmed(voucherCode) {
    showPayStep("connecting");
    // No arbitrary wait needed — the poll above only reaches here once the router has
    // confirmed the voucher (routerProvisioned).
    try {
      var r = await fetch("/portal/validate-voucher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: voucherCode, mac: pageMac, ip: pageIp, linkLogin: pageLinkLogin }),
      });
      var data = await r.json();
      if (!r.ok) {
        // Show voucher code for manual entry if MikroTik provisioning hasn't completed
        var we = document.getElementById("pay-waiting-err");
        showPayStep("waiting");
        if (we) { we.textContent = "Your voucher code is: " + voucherCode + " — enter it in the Voucher tab."; we.classList.add("on"); }
        document.getElementById("pay-countdown").textContent = "";
        return;
      }
      if (!fromMikrotik) {
        // Not arriving via the hotspot, so there is no login form to submit and no way
        // to put this device online from here. Hand over the code rather than leaving
        // the user staring at a "connecting" spinner.
        showPayStep("waiting");
        var wi = document.getElementById("pay-waiting-err");
        if (wi) { wi.textContent = "Your voucher code is: " + voucherCode + " — connect to the WiFi and enter it in the Voucher tab."; wi.classList.add("on"); }
        document.getElementById("pay-countdown").textContent = "";
        return;
      }
      document.getElementById("mt-user").value = data.username;
      document.getElementById("mt-pass").value = data.password;
      setTimeout(function() { document.getElementById("mt-form").submit(); }, 800);
    } catch(e) {
      // A network error here means we do NOT know whether the user got online —
      // claiming "Connected!" was a guess that was wrong exactly when it mattered.
      showPayStep("waiting");
      var we = document.getElementById("pay-waiting-err");
      if (we) { we.textContent = "We couldn't confirm your connection. Your voucher code is: " + voucherCode + " — enter it in the Voucher tab."; we.classList.add("on"); }
    }
  }

  function cancelPayment() {
    clearInterval(payPollTimer); clearInterval(payCountdownTimer);
    showPayStep("input");
    var btn = document.getElementById("pay-btn");
    if (btn) { btn.disabled = false; btn.innerHTML = "Pay via Mobile Money"; }
    var err = document.getElementById("pay-err");
    if (err) err.classList.remove("on");
    var we = document.getElementById("pay-waiting-err");
    if (we) { we.textContent = ""; we.classList.remove("on"); }
  }

  function showErr(el, msg) {
    el.textContent = msg;
    el.classList.add("on");
  }

  window.addEventListener("DOMContentLoaded", function() {
    var codeInput = document.getElementById("code");
    if (codeInput && codeInput.value.trim()) {
      switchTab("v", document.getElementById("tab-v"));
      setTimeout(submitVoucher, 800);
    }
  });
</script>
</body>
</html>`;
}

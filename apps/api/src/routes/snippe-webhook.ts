import express, { Router, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { payments } from "../db/schema.js";
import { logSystemEvent } from "../utils/audit.js";
import {
  SNIPPE_TERMINAL_FAILURE_STATUSES,
  markPaymentFailed,
  processPaymentCompleted,
} from "../utils/snippe.js";

export const snippeWebhookRouter = Router();

// Every event that terminally kills a payment. `payment.cancelled` is what the live API
// actually sends when the 10-minute authorisation window lapses (the docs advertise
// `payment.voided`/`payment.expired`) — derived from the shared status list so the
// webhook, the portal poll and the reconcile sweep can never disagree.
const TERMINAL_FAILURE_EVENTS = new Set(
  SNIPPE_TERMINAL_FAILURE_STATUSES.map((s) => `payment.${s}`),
);

/**
 * Throttle for rejection audit rows.
 *
 * This endpoint is public and unauthenticated by design, so anyone can make it write an
 * audit row. Without a cap, a hammering client turns the audit log into its own denial of
 * service. Suppressed hits are counted and reported on the next row that does get written,
 * so a flood is still visible — just not row-by-row.
 */
const REJECTION_LOG_WINDOW_MS = 60_000;
const REJECTION_LOG_MAX_PER_WINDOW = 10;
let rejectionWindowStart = 0;
let rejectionsInWindow = 0;
let rejectionsSuppressed = 0;

/** The real client IP — ngrok/any proxy puts it in X-Forwarded-For, req.ip is the tunnel. */
function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  if (raw) return raw.split(",")[0]?.trim() ?? null;
  return req.ip ?? req.socket.remoteAddress ?? null;
}

function headerValue(req: Request, name: string): string | null {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

/**
 * Persist a rejected webhook.
 *
 * Previously these only reached `console.error`, so the evidence lived in a scrollback
 * buffer — the one probe we did catch was reconstructed from ngrok's inspector, which
 * would have been gone within the hour. Never awaited: the 400 must not wait on a DB write.
 */
function recordRejection(req: Request, reason: string, rawBody: string): void {
  const now = Date.now();
  if (now - rejectionWindowStart > REJECTION_LOG_WINDOW_MS) {
    rejectionWindowStart = now;
    rejectionsInWindow = 0;
  }

  rejectionsInWindow++;
  if (rejectionsInWindow > REJECTION_LOG_MAX_PER_WINDOW) {
    rejectionsSuppressed++;
    return;
  }

  const suppressed = rejectionsSuppressed;
  rejectionsSuppressed = 0;

  // logSystemEvent never throws, but this is a rejection path — don't let it delay the 400.
  void logSystemEvent({
    action: "webhook.signature_rejected",
    entityType: "webhook",
    entityName: "snippe",
    ipAddress: clientIp(req),
    userAgent: headerValue(req, "user-agent"),
    details: {
      reason,
      // Header event type is untrusted here by definition — the signature just failed.
      claimedEvent: headerValue(req, "x-webhook-event"),
      timestampHeader: headerValue(req, "x-webhook-timestamp"),
      signatureHeader: headerValue(req, "x-webhook-signature"),
      // Truncated: enough to identify the payload shape without storing an unbounded blob.
      bodyPreview: rawBody.slice(0, 512),
      bodyBytes: Buffer.byteLength(rawBody, "utf8"),
      ...(suppressed > 0 ? { suppressedSinceLastLog: suppressed } : {}),
    },
  });
}

function verifySignature(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  signingKey: string,
): void {
  const timestamp = headers["x-webhook-timestamp"];
  const signature = headers["x-webhook-signature"];

  if (!timestamp || !signature || Array.isArray(timestamp) || Array.isArray(signature)) {
    throw new Error("Missing webhook headers");
  }

  const eventTime = parseInt(timestamp, 10);
  if (isNaN(eventTime) || Math.floor(Date.now() / 1000) - eventTime > 300) {
    throw new Error("Webhook timestamp too old or invalid");
  }

  const message = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", signingKey).update(message).digest("hex");

  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid webhook signature");
  }
}

// Mount with express.raw — this route MUST be registered before express.json() globally
snippeWebhookRouter.post("/snippe", express.raw({ type: "application/json" }), (req, res) => {
  const signingKey = process.env.SNIPPE_WEBHOOK_SECRET;
  if (!signingKey) {
    // Every webhook is being dropped on the floor while this is true — a silent outage
    // that only shows up later as payments stuck with no voucher. Make it auditable.
    console.error("[SnippeWebhook] SNIPPE_WEBHOOK_SECRET not configured");
    void logSystemEvent({
      action: "webhook.misconfigured",
      entityType: "webhook",
      entityName: "snippe",
      details: { reason: "SNIPPE_WEBHOOK_SECRET is not set — all webhooks are being rejected" },
    });
    res.status(500).send("Server misconfigured");
    return;
  }

  const rawBody = (req.body as Buffer).toString("utf8");

  try {
    verifySignature(
      rawBody,
      req.headers as Record<string, string | string[] | undefined>,
      signingKey,
    );
  } catch (err) {
    const reason = (err as Error).message;
    console.error("[SnippeWebhook] Signature verification failed:", reason);
    recordRejection(req, reason, rawBody);
    res.status(400).send("Invalid signature");
    return;
  }

  // Respond 200 immediately — Snippe requires a response within 30 seconds
  res.status(200).send("OK");

  // Process asynchronously after responding
  handleWebhookEvent(rawBody).catch((err: Error) => {
    console.error("[SnippeWebhook] Processing error:", err.message);
  });
});

async function handleWebhookEvent(rawBody: string): Promise<void> {
  let event: {
    id: string;
    type: string;
    data: { reference: string; status: string; failure_reason?: string };
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    console.error("[SnippeWebhook] Invalid JSON body");
    return;
  }

  const { id: eventId, type: eventType, data } = event;

  if (!data?.reference) return;

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.providerReference, data.reference))
    .limit(1);

  if (!payment) {
    console.warn("[SnippeWebhook] No payment found for reference:", data.reference);
    return;
  }

  if (eventType === "payment.completed") {
    await processPaymentCompleted(payment, eventId);
  } else if (TERMINAL_FAILURE_EVENTS.has(eventType)) {
    // A payment that already produced a voucher must never be walked back by a late
    // failure event — money captured + voucher issued is the final word.
    if (payment.status === "paid") {
      console.warn(`[SnippeWebhook] Ignoring ${eventType} for already-paid payment ${payment.id}`);
      return;
    }

    const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
    if (metadata.processedEventId === eventId) return;

    await markPaymentFailed(payment, eventType, data.failure_reason ?? null, eventId);

    console.log(
      `[SnippeWebhook] Payment ${payment.id} → ${eventType}` +
        (data.failure_reason ? ` (${data.failure_reason})` : ""),
    );
  } else {
    // Unknown/unhandled event type — log loudly rather than silently 200-ing, which is
    // how `payment.cancelled` went unnoticed and left payments stuck at "pending".
    console.warn(`[SnippeWebhook] Unhandled event type "${eventType}" for payment ${payment.id}`);
  }
}

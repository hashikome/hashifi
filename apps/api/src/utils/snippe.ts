import { randomBytes, randomUUID } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { packages, payments, routers, vouchers } from "../db/schema.js";
import {
  describeFailures,
  outcomeOk,
  pushVouchersToVenueRouters,
} from "../services/router-sync.js";
import { logSystemEvent } from "./audit.js";

/**
 * Statuses from which a payment can never recover. `cancelled` is what the live API
 * reports when the ~10-minute authorisation window lapses — it is absent from the
 * published docs, and omitting it is what left payments stuck at `pending` forever.
 * Every caller must use THIS list so the webhook, the portal poll and the reconcile
 * sweep can never drift apart again.
 */
export const SNIPPE_TERMINAL_FAILURE_STATUSES = ["failed", "expired", "cancelled", "voided"];

export interface SnippePayment {
  reference: string;
  status: string;
  failure_reason?: string;
  /** The upstream processor's reference (`ML…`/`MP…`) — what Snippe support traces a debit by. */
  external_reference?: string;
}

/** Read a payment back from Snippe. Returns null if unreachable or not found. */
export async function fetchSnippePayment(reference: string): Promise<SnippePayment | null> {
  const apiKey = process.env.SNIPPE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`https://api.snippe.sh/v1/payments/${reference}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const body = (await res.json()) as { data?: SnippePayment };
    if (!res.ok || !body.data) return null;
    return body.data;
  } catch {
    return null;
  }
}

/**
 * Record a terminal failure against a payment, preserving existing metadata.
 * Pass `processedEventId` from a webhook so re-delivery of the same event is a no-op.
 */
export async function markPaymentFailed(
  payment: typeof payments.$inferSelect,
  failedEvent: string,
  failureReason: string | null,
  processedEventId?: string,
): Promise<void> {
  const meta = (payment.metadata ?? {}) as Record<string, unknown>;
  await db
    .update(payments)
    .set({
      status: "failed",
      metadata: {
        ...meta,
        failedEvent,
        failureReason: failureReason ?? null,
        ...(processedEventId ? { processedEventId } : {}),
      },
    })
    .where(eq(payments.id, payment.id));
}

export type PendingResolution = "completed" | "failed" | "still_pending" | "unreachable";

/**
 * Ask Snippe what really happened to a payment we still think is `pending`, and settle it.
 *
 * This is the safety net for a dropped webhook: without it, a payment the customer
 * genuinely completed stays `pending` forever and the customer never gets a voucher
 * despite having paid.
 */
export async function resolvePendingPayment(
  payment: typeof payments.$inferSelect,
): Promise<PendingResolution> {
  if (!payment.providerReference) return "unreachable";

  const remote = await fetchSnippePayment(payment.providerReference);
  if (!remote) return "unreachable";

  if (remote.status === "completed") {
    await processPaymentCompleted(payment, `reconcile-${payment.providerReference}`);
    return "completed";
  }

  if (SNIPPE_TERMINAL_FAILURE_STATUSES.includes(remote.status)) {
    await markPaymentFailed(payment, `reconcile:${remote.status}`, remote.failure_reason ?? null);
    return "failed";
  }

  return "still_pending";
}

async function resolveVenueFromLinkLogin(linkLogin: unknown): Promise<string | null> {
  if (typeof linkLogin !== "string" || !linkLogin) return null;
  try {
    const routerIp = new URL(linkLogin).hostname;
    const [router] = await db
      .select({ venueId: routers.venueId })
      .from(routers)
      .where(or(eq(routers.ipAddress, routerIp), eq(routers.hotspotGatewayIp, routerIp)))
      .limit(1);
    return router?.venueId ?? null;
  } catch {
    return null;
  }
}

function generateVoucherCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let s = "";
  for (const b of bytes) s += chars[b % chars.length];
  return `PMT-${s.slice(0, 4)}-${s.slice(4)}`;
}

export async function processPaymentCompleted(
  payment: typeof payments.$inferSelect,
  snippeEventId: string,
): Promise<void> {
  // Payment already processed — stop regardless of which event ID triggered this
  if (payment.status === "paid") return;

  const metadata = (payment.metadata ?? {}) as Record<string, unknown>;

  // Deduplicate same-event re-delivery
  if (metadata.processedEventId === snippeEventId) return;

  if (!payment.packageId) {
    console.error("[Snippe] Payment has no packageId:", payment.id);
    return;
  }

  const [pkg] = await db.select().from(packages).where(eq(packages.id, payment.packageId)).limit(1);

  if (!pkg) {
    console.error("[Snippe] Package not found:", payment.packageId);
    return;
  }

  // Generate a unique voucher code (retry on collision)
  let voucherCode = "";
  for (let i = 0; i < 10; i++) {
    const candidate = generateVoucherCode();
    const [existing] = await db
      .select({ id: vouchers.id })
      .from(vouchers)
      .where(eq(vouchers.code, candidate))
      .limit(1);
    if (!existing) {
      voucherCode = candidate;
      break;
    }
  }

  if (!voucherCode) {
    console.error("[Snippe] Failed to generate unique voucher code for payment:", payment.id);
    return;
  }

  const voucherId = randomUUID();

  await db.insert(vouchers).values({
    id: voucherId,
    packageId: payment.packageId,
    venueId: payment.venueId ?? null,
    code: voucherCode,
    status: "unused",
    durationMinutes: pkg.durationMinutes,
    dataLimitGb: pkg.dataLimitGb ?? null,
    priceTsh: String(payment.amountTsh),
  });

  await db
    .update(payments)
    .set({
      status: "paid",
      voucherId,
      paidAt: new Date(),
      metadata: { ...metadata, processedEventId: snippeEventId, voucherCode },
    })
    .where(eq(payments.id, payment.id));

  console.log(`[Snippe] Payment ${payment.id} completed → voucher ${voucherCode}`);

  // Push voucher to MikroTik routers for the venue.
  // If the payment has no venueId (e.g. router IP lookup failed at initiation time),
  // try again using the linkLogin URL stored in metadata.
  let effectiveVenueId = payment.venueId;
  if (!effectiveVenueId) {
    effectiveVenueId = await resolveVenueFromLinkLogin(metadata.linkLogin);
    if (effectiveVenueId) {
      // Backfill venueId on the voucher so JIT sync and expiry daemon can use it
      await db
        .update(vouchers)
        .set({ venueId: effectiveVenueId })
        .where(eq(vouchers.id, voucherId));
      console.log(
        `[Snippe] Resolved venueId ${effectiveVenueId} from linkLogin for voucher ${voucherCode}`,
      );
    }
  }

  // ── Push to the router and record whether it actually worked ──────────────
  // This used to be fire-and-forget with a console.error, so a payment could sit at
  // "paid" forever with a voucher the router had never heard of. The webhook has
  // already ACKed 200 to Snippe (see the route handler), so awaiting here is safe.
  if (!effectiveVenueId) {
    const error = `No venue could be resolved for payment ${payment.id} — voucher ${voucherCode} was never pushed to a router`;
    console.error(`[Snippe] ${error}`);
    await db.update(payments).set({ provisionError: error }).where(eq(payments.id, payment.id));
    await logSystemEvent({
      action: "payment.provision_failed",
      entityType: "payment",
      entityId: payment.id,
      entityName: voucherCode,
      details: { reason: error },
    });
    return;
  }

  try {
    const outcome = await pushVouchersToVenueRouters(
      effectiveVenueId,
      [voucherCode],
      pkg,
      pkg.dataLimitGb ?? null,
    );

    if (outcomeOk(outcome)) {
      await db
        .update(payments)
        .set({ routerProvisionedAt: new Date(), provisionError: null })
        .where(eq(payments.id, payment.id));
      console.log(`[Snippe] Voucher ${voucherCode} confirmed on ${outcome.succeeded} router(s)`);
    } else {
      const error = describeFailures(outcome);
      console.error(`[Snippe] Router did not confirm voucher ${voucherCode}: ${error}`);
      await db.update(payments).set({ provisionError: error }).where(eq(payments.id, payment.id));
      await logSystemEvent({
        action: "payment.provision_failed",
        entityType: "payment",
        entityId: payment.id,
        entityName: voucherCode,
        // The reconcile daemon will keep retrying this — see reconcile-daemon.ts
        details: { reason: error, willRetry: true },
      });
    }
  } catch (err) {
    const error = (err as Error).message;
    console.error(`[Snippe] MikroTik push failed for voucher ${voucherCode}:`, error);
    await db.update(payments).set({ provisionError: error }).where(eq(payments.id, payment.id));
    await logSystemEvent({
      action: "payment.provision_failed",
      entityType: "payment",
      entityId: payment.id,
      entityName: voucherCode,
      details: { reason: error, willRetry: true },
    });
  }
}

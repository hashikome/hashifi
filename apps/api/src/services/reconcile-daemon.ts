/**
 * Reconciliation sweep — the safety net under Phase 3.
 *
 * B1/B2 made the request paths honest: a voucher stays `pending_activation` and a payment
 * keeps `router_provisioned_at = NULL` until the router confirms. That is correct, but it
 * leaves real customers stranded when a router is briefly unreachable — they paid, and
 * nothing retries on their behalf.
 *
 * This daemon finds those gaps and retries them. It is the difference between "we no
 * longer lie about success" and "it actually works".
 */

import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { packages, payments, vouchers } from "../db/schema.js";
import { logSystemEvent } from "../utils/audit.js";
import { resolvePendingPayment } from "../utils/snippe.js";
import {
  describeFailures,
  ensureVoucherOnVenueRouters,
  outcomeOk,
  pushVouchersToVenueRouters,
} from "./router-sync.js";

const CHECK_INTERVAL_MS = 60_000;
/** Give the request path time to finish before we start second-guessing it. */
const MIN_AGE_MS = 30_000;
/** Past this, a stuck item is an operational problem, not a transient blip. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Bound the work per tick so a large backlog can't monopolise the router. */
const BATCH_LIMIT = 25;
/**
 * Don't second-guess a pending payment until its authorisation window has lapsed —
 * Snippe grants ~10 minutes, and before that the customer can still legitimately pay.
 */
const PENDING_MIN_AGE_MS = 12 * 60 * 1000;

async function reconcileVouchers(now: Date): Promise<void> {
  const stuck = await db
    .select({
      id: vouchers.id,
      code: vouchers.code,
      venueId: vouchers.venueId,
      activatedAt: vouchers.activatedAt,
    })
    .from(vouchers)
    .where(
      and(
        eq(vouchers.status, "pending_activation"),
        lt(vouchers.activatedAt, new Date(now.getTime() - MIN_AGE_MS)),
        gt(vouchers.activatedAt, new Date(now.getTime() - MAX_AGE_MS)),
      ),
    )
    .limit(BATCH_LIMIT);

  if (stuck.length === 0) return;

  console.log(`[Reconcile] Retrying ${stuck.length} voucher(s) stuck in pending_activation`);

  for (const voucher of stuck) {
    if (!voucher.venueId) {
      await logSystemEvent({
        action: "voucher.provision_failed",
        entityType: "voucher",
        entityId: voucher.id,
        entityName: voucher.code,
        details: { reason: "Voucher has no venue — cannot determine which router to push to" },
      });
      continue;
    }

    try {
      const outcome = await ensureVoucherOnVenueRouters(voucher.venueId, voucher.code);

      if (outcomeOk(outcome)) {
        await db.update(vouchers).set({ status: "active" }).where(eq(vouchers.id, voucher.id));
        console.log(`[Reconcile] Voucher ${voucher.code} confirmed and activated`);
        await logSystemEvent({
          action: "voucher.provision_recovered",
          entityType: "voucher",
          entityId: voucher.id,
          entityName: voucher.code,
          details: { routers: outcome.succeeded },
        });
      } else {
        await logSystemEvent({
          action: "voucher.provision_failed",
          entityType: "voucher",
          entityId: voucher.id,
          entityName: voucher.code,
          details: { reason: describeFailures(outcome), attemptedRouters: outcome.attempted },
        });
      }
    } catch (err) {
      await logSystemEvent({
        action: "voucher.provision_failed",
        entityType: "voucher",
        entityId: voucher.id,
        entityName: voucher.code,
        details: { reason: (err as Error).message },
      });
    }
  }
}

async function reconcilePayments(now: Date): Promise<void> {
  const stuck = await db
    .select({
      payment: payments,
      pkg: packages,
    })
    .from(payments)
    .leftJoin(packages, eq(payments.packageId, packages.id))
    .where(
      and(
        eq(payments.status, "paid"),
        isNull(payments.routerProvisionedAt),
        isNotNull(payments.paidAt),
        lt(payments.paidAt, new Date(now.getTime() - MIN_AGE_MS)),
        gt(payments.paidAt, new Date(now.getTime() - MAX_AGE_MS)),
      ),
    )
    .limit(BATCH_LIMIT);

  if (stuck.length === 0) return;

  console.log(`[Reconcile] Retrying ${stuck.length} paid payment(s) with no router confirmation`);

  for (const { payment, pkg } of stuck) {
    const meta = (payment.metadata ?? {}) as Record<string, unknown>;
    const code = typeof meta.voucherCode === "string" ? meta.voucherCode : null;

    if (!code || !payment.venueId || !pkg) {
      await logSystemEvent({
        action: "payment.provision_failed",
        entityType: "payment",
        entityId: payment.id,
        details: {
          reason: !code
            ? "Payment has no voucher code in metadata"
            : !payment.venueId
              ? "Payment has no venue"
              : "Payment has no package",
        },
      });
      continue;
    }

    try {
      const outcome = await pushVouchersToVenueRouters(
        payment.venueId,
        [code],
        pkg,
        pkg.dataLimitGb ?? null,
      );

      if (outcomeOk(outcome)) {
        await db
          .update(payments)
          .set({ routerProvisionedAt: new Date(), provisionError: null })
          .where(eq(payments.id, payment.id));
        console.log(`[Reconcile] Payment ${payment.id} → voucher ${code} confirmed on router`);
        await logSystemEvent({
          action: "payment.provision_recovered",
          entityType: "payment",
          entityId: payment.id,
          entityName: code,
          details: { routers: outcome.succeeded },
        });
      } else {
        const reason = describeFailures(outcome);
        await db
          .update(payments)
          .set({ provisionError: reason })
          .where(eq(payments.id, payment.id));
        await logSystemEvent({
          action: "payment.provision_failed",
          entityType: "payment",
          entityId: payment.id,
          entityName: code,
          details: { reason },
        });
      }
    } catch (err) {
      await logSystemEvent({
        action: "payment.provision_failed",
        entityType: "payment",
        entityId: payment.id,
        entityName: code,
        details: { reason: (err as Error).message },
      });
    }
  }
}

/**
 * Settle payments still sitting at `pending`.
 *
 * The portal polls Snippe only while the browser tab is open, and a dropped
 * `payment.completed` webhook has no other recovery path — so a customer who paid and
 * then closed the tab would never get a voucher, and the admin list would fill with rows
 * that can never resolve themselves. This asks Snippe what actually happened.
 *
 * Only rows past the authorisation window are touched; before that the payment is still
 * legitimately payable and the portal poll owns it.
 */
async function reconcilePendingPayments(now: Date): Promise<void> {
  const stuck = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.status, "pending"),
        isNotNull(payments.providerReference),
        lt(payments.createdAt, new Date(now.getTime() - PENDING_MIN_AGE_MS)),
        gt(payments.createdAt, new Date(now.getTime() - MAX_AGE_MS)),
      ),
    )
    .limit(BATCH_LIMIT);

  if (stuck.length === 0) return;

  console.log(`[Reconcile] Checking ${stuck.length} pending payment(s) against Snippe`);

  for (const payment of stuck) {
    try {
      const outcome = await resolvePendingPayment(payment);

      if (outcome === "completed") {
        // A real payment whose webhook never arrived — this is recovered revenue.
        console.log(`[Reconcile] Pending payment ${payment.id} was actually paid — recovered`);
        await logSystemEvent({
          action: "payment.recovered_from_pending",
          entityType: "payment",
          entityId: payment.id,
          details: { reference: payment.providerReference },
        });
      } else if (outcome === "failed") {
        console.log(`[Reconcile] Pending payment ${payment.id} settled as failed`);
      }
    } catch (err) {
      console.error(`[Reconcile] Error resolving pending payment ${payment.id}:`, err);
    }
  }
}

/**
 * Count customers currently stranded — surfaced to admins.
 *
 * Bounded to the same window the sweep acts on. Without that bound this would count every
 * payment made before `router_provisioned_at` existed (all NULL by definition), showing a
 * permanent false alarm for rows nothing will ever retry.
 */
export async function getProvisioningBacklog(): Promise<{
  stuckVouchers: number;
  unprovisionedPayments: number;
}> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);

  const [voucherRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(vouchers)
    .where(and(eq(vouchers.status, "pending_activation"), gt(vouchers.activatedAt, cutoff)));

  const [paymentRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(payments)
    .where(
      and(
        eq(payments.status, "paid"),
        isNull(payments.routerProvisionedAt),
        gt(payments.paidAt, cutoff),
      ),
    );

  return {
    stuckVouchers: Number(voucherRow?.count ?? 0),
    unprovisionedPayments: Number(paymentRow?.count ?? 0),
  };
}

export function startReconcileDaemon(): void {
  const run = async () => {
    const now = new Date();
    await reconcileVouchers(now);
    await reconcilePayments(now);
    await reconcilePendingPayments(now);
  };

  const interval = setInterval(() => {
    run().catch((err) => console.error("[Reconcile] Unhandled error:", err));
  }, CHECK_INTERVAL_MS);

  if (interval.unref) interval.unref();

  // Catch anything stranded while the server was down.
  run().catch((err) => console.error("[Reconcile] Startup run error:", err));

  console.log("[Reconcile] Started — retrying unconfirmed vouchers/payments every 60s");
}

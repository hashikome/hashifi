import type { AuditLog } from "../audit/audit-log.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { enrichWideEvent } from "../observability/wide-event.js";
import { describeFailures, outcomeOk, type RouterSync } from "../services/router-sync.js";

/** Leave the request path time to finish before second-guessing it. */
const MIN_AGE_MS = 30_000;
/** Past this, a stuck voucher is an operational problem, not a transient blip. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Bounded per run, so a large backlog cannot monopolise the routers. */
const BATCH_LIMIT = 25;

/**
 * Retries vouchers stuck in `pending_activation`: redeemed, but never confirmed by a router
 * (it was unreachable). Nothing reports access until a router confirms it; this is what makes
 * that rule recover instead of stranding the guest.
 */
export class VoucherReconciler {
  constructor(
    private readonly db: PrismaClient,
    private readonly sync: RouterSync,
    private readonly audit: AuditLog,
  ) {}

  async runOnce(now: Date = new Date()): Promise<{ retried: number; recovered: number }> {
    const stuck = await this.db.voucher.findMany({
      where: {
        status: "pending_activation",
        activatedAt: {
          lt: new Date(now.getTime() - MIN_AGE_MS),
          gt: new Date(now.getTime() - MAX_AGE_MS),
        },
      },
      select: { id: true, code: true, venueId: true },
      take: BATCH_LIMIT,
    });

    let recovered = 0;
    for (const voucher of stuck) {
      const entity = { type: "voucher", id: voucher.id, name: null };
      if (!voucher.venueId) {
        await this.audit.system("voucher.provision_failed", entity, {
          reason: "The voucher has no venue, so no router can be chosen",
        });
        continue;
      }
      try {
        const outcome = await this.sync.ensureVoucher(voucher.venueId, voucher.code);
        if (outcomeOk(outcome)) {
          await this.db.voucher.update({ where: { id: voucher.id }, data: { status: "active" } });
          recovered++;
          await this.audit.system("voucher.provision_recovered", entity, {
            routers: outcome.succeeded,
          });
        } else {
          await this.audit.system("voucher.provision_failed", entity, {
            reason: describeFailures(outcome),
            attemptedRouters: outcome.attempted,
          });
        }
      } catch (err) {
        await this.audit.system("voucher.provision_failed", entity, {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    enrichWideEvent({ "reconcile.retried": stuck.length });
    return { retried: stuck.length, recovered };
  }

  /** Vouchers still waiting on a router, within the window this retries. */
  async backlog(now: Date = new Date()): Promise<number> {
    return this.db.voucher.count({
      where: {
        status: "pending_activation",
        activatedAt: { gt: new Date(now.getTime() - MAX_AGE_MS) },
      },
    });
  }
}

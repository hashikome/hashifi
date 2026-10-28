/**
 * One-off backfill: settle every payment still stuck at `pending`.
 *
 * The reconcile daemon only looks back 24 hours (see MAX_AGE_MS), so rows that were
 * stranded before the `payment.cancelled` handling landed will never be swept up by it.
 * This walks the full history once and asks Snippe what actually happened to each one.
 *
 * A payment Snippe reports as `completed` is provisioned properly through
 * `processPaymentCompleted` — voucher generated and pushed to the router — so this
 * recovers real revenue rather than just tidying the admin list.
 *
 * Usage:
 *   bun run src/scripts/reconcile-pending-payments.ts            # report only
 *   bun run src/scripts/reconcile-pending-payments.ts --apply    # write changes
 */

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { payments } from "../db/schema.js";
import { fetchSnippePayment, resolvePendingPayment } from "../utils/snippe.js";

const APPLY = process.argv.includes("--apply");

/** Snippe allows 60 requests/minute — stay well under it. */
const REQUEST_SPACING_MS = 1100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (!process.env.SNIPPE_API_KEY) {
    console.error("SNIPPE_API_KEY is not set — cannot reconcile against Snippe.");
    process.exit(1);
  }

  const pending = await db
    .select()
    .from(payments)
    .where(and(eq(payments.status, "pending"), isNotNull(payments.providerReference)));

  console.log(
    `Found ${pending.length} pending payment(s) with a provider reference.` +
      (APPLY ? " Applying changes.\n" : " DRY RUN — pass --apply to write.\n"),
  );

  const tally: Record<string, number> = {};

  for (const [i, payment] of pending.entries()) {
    if (i > 0) await sleep(REQUEST_SPACING_MS);

    const ref = payment.providerReference ?? "";
    // `sv-SE` gives "YYYY-MM-DD HH:mm" and, with process.env.TZ pinned to
    // Africa/Dar_es_Salaam, renders the business's calendar time rather than UTC.
    const created = payment.createdAt
      ? payment.createdAt.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
      : "?";

    if (!APPLY) {
      // Read-only: report what Snippe says without touching the row.
      const remote = await fetchSnippePayment(ref);
      const status = remote?.status ?? "unreachable";
      tally[status] = (tally[status] ?? 0) + 1;
      console.log(
        `  ${created}  ${ref.padEnd(22)} → ${status}` +
          (remote?.failure_reason ? `  (${remote.failure_reason})` : ""),
      );
      continue;
    }

    const outcome = await resolvePendingPayment(payment);
    tally[outcome] = (tally[outcome] ?? 0) + 1;
    console.log(`  ${created}  ${ref.padEnd(22)} → ${outcome}`);
  }

  console.log("\nSummary:");
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}`);
  if (!APPLY && pending.length > 0) console.log("\nRe-run with --apply to write these results.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reconcile failed:", err);
    process.exit(1);
  });

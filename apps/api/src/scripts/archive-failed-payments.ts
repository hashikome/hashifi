/**
 * Write failed payments into the audit log as durable records.
 *
 * Deleting a payment row removes the only evidence that the transaction ever happened —
 * which matters most for exactly these rows, where a customer's wallet may have been
 * debited while Snippe recorded the payment as expired. The admin list is the wrong place
 * to keep them (they are noise there), but the audit log is the right one: append-only,
 * queryable, and never surfaced as revenue.
 *
 * Two sources are archived:
 *   1. Rows recovered from the mysqldump backups into `payments_archive_restore`
 *      (already deleted from `payments` — flagged `recordDeleted: true`).
 *   2. Failed payments from today still present in `payments`.
 *
 * Each record is keyed by its Snippe reference (`SN…`) as the audit entity name, and
 * enriched with the gateway's `external_reference` (the `ML…`/`MP…` number Snippe support
 * needs to trace a debit).
 *
 * Idempotent: re-running skips payments already archived.
 *
 * Usage:
 *   bun run src/scripts/archive-failed-payments.ts            # report only
 *   bun run src/scripts/archive-failed-payments.ts --apply    # write audit rows
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import { decimal, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { db } from "../db/index.js";
import { auditLogs, payments } from "../db/schema.js";
import { logAction } from "../utils/audit.js";
import { fetchSnippePayment } from "../utils/snippe.js";

const APPLY = process.argv.includes("--apply");
const ARCHIVE_ACTION = "payment.archived";
/** Snippe allows 60 requests/minute. */
const REQUEST_SPACING_MS = 1100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The scratch table holding rows restored from the mysqldump backups. Same shape as
 * `payments`; declared separately so the normal query builder (and its UTC session
 * handling) applies rather than hand-rolled raw SQL.
 */
const restoredPayments = mysqlTable("payments_archive_restore", {
  id: varchar("id", { length: 36 }).primaryKey(),
  packageId: varchar("package_id", { length: 36 }),
  venueId: varchar("venue_id", { length: 36 }),
  provider: varchar("provider", { length: 20 }),
  providerReference: varchar("provider_reference", { length: 160 }),
  phone: varchar("phone", { length: 32 }),
  amountTsh: decimal("amount_tsh", { precision: 12, scale: 2 }),
  status: varchar("status", { length: 20 }),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at"),
});

interface ArchiveCandidate {
  id: string;
  reference: string;
  phone: string | null;
  amountTsh: string | null;
  provider: string | null;
  status: string | null;
  packageId: string | null;
  venueId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date | null;
  recordDeleted: boolean;
}

/** EAT calendar midnight — process.env.TZ is pinned, so local components are correct. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function collectCandidates(): Promise<ArchiveCandidate[]> {
  const out: ArchiveCandidate[] = [];

  // 1. Deleted rows recovered from the backups.
  let restored: (typeof restoredPayments.$inferSelect)[] = [];
  try {
    restored = await db.select().from(restoredPayments);
  } catch {
    console.warn(
      "  (payments_archive_restore not present — skipping deleted-row archive)\n",
    );
  }

  for (const row of restored) {
    if (!row.providerReference) continue;
    out.push({
      id: row.id,
      reference: row.providerReference,
      phone: row.phone,
      amountTsh: row.amountTsh,
      provider: row.provider,
      status: row.status,
      packageId: row.packageId,
      venueId: row.venueId,
      metadata: row.metadata ?? {},
      createdAt: row.createdAt,
      recordDeleted: true,
    });
  }

  // 2. Today's failed payments still in the table.
  const todaysFailed = await db
    .select()
    .from(payments)
    .where(and(eq(payments.status, "failed"), gte(payments.createdAt, startOfToday())));

  for (const row of todaysFailed) {
    if (!row.providerReference) continue;
    out.push({
      id: row.id,
      reference: row.providerReference,
      phone: row.phone,
      amountTsh: row.amountTsh,
      provider: row.provider,
      status: row.status,
      packageId: row.packageId,
      venueId: row.venueId,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
      recordDeleted: false,
    });
  }

  return out.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/** Payment IDs that already have an archive row, so re-runs don't duplicate. */
async function alreadyArchived(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ entityId: auditLogs.entityId })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, ARCHIVE_ACTION), inArray(auditLogs.entityId, ids)));
  return new Set(rows.map((r) => r.entityId).filter((v): v is string => v !== null));
}

async function main(): Promise<void> {
  const candidates = await collectCandidates();
  const skip = await alreadyArchived(candidates.map((c) => c.id));
  const todo = candidates.filter((c) => !skip.has(c.id));

  console.log(
    `${candidates.length} failed payment(s) to archive` +
      (skip.size > 0 ? `, ${skip.size} already archived (skipped)` : "") +
      (APPLY ? ". Writing audit rows.\n" : ". DRY RUN — pass --apply to write.\n"),
  );

  if (todo.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let written = 0;

  for (const [i, c] of todo.entries()) {
    if (i > 0) await sleep(REQUEST_SPACING_MS);

    // Pull the gateway's own record so the archive carries the number Snippe support uses.
    const remote = await fetchSnippePayment(c.reference);

    const when = c.createdAt
      ? c.createdAt.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
      : "?";
    const flag = c.recordDeleted ? "deleted" : "in-table";

    console.log(
      `  ${when}  ${c.reference.padEnd(22)} ${String(c.phone).padEnd(14)} ` +
        `TSh ${String(c.amountTsh).padStart(8)}  ${flag.padEnd(9)} ` +
        `${remote?.external_reference ?? "—"}  ${remote?.status ?? "unreachable"}`,
    );

    if (!APPLY) continue;

    await logAction({
      adminUserId: null,
      actorName: "system",
      action: ARCHIVE_ACTION,
      entityType: "payment",
      entityId: c.id,
      // The SN number is the human-facing identity of the transaction.
      entityName: c.reference,
      details: {
        reference: c.reference,
        externalReference: remote?.external_reference ?? null,
        gatewayStatus: remote?.status ?? null,
        gatewayFailureReason: remote?.failure_reason ?? null,
        localStatus: c.status,
        failedEvent: c.metadata.failedEvent ?? null,
        failureReason: c.metadata.failureReason ?? null,
        phone: c.phone,
        amountTsh: c.amountTsh,
        provider: c.provider,
        packageId: c.packageId,
        venueId: c.venueId,
        deviceMac: c.metadata.mac ?? null,
        deviceIp: c.metadata.ip ?? null,
        // True UTC instant — the audit row's own created_at is the archive time, not this.
        paymentCreatedAt: c.createdAt?.toISOString() ?? null,
        recordDeleted: c.recordDeleted,
        archivedBy: "archive-failed-payments script",
      },
    });
    written++;
  }

  console.log(
    APPLY
      ? `\nWrote ${written} audit row(s) with action "${ARCHIVE_ACTION}".`
      : `\nRe-run with --apply to write ${todo.length} audit row(s).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Archive failed:", err);
    process.exit(1);
  });

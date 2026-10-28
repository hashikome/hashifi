import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";

interface LogActionOptions {
  adminUserId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Record something the system did on its own — a failed router push, a reconciliation
 * retry — with no admin behind it. These previously vanished into `console.error`, which
 * meant nobody found out until a customer complained about having no internet.
 *
 * Never throws: an audit write must not take down the operation it is describing.
 */
export async function logSystemEvent(opts: {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  /** Set for events triggered by an outside caller (e.g. a rejected webhook). */
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await logAction({
      adminUserId: null,
      actorName: "system",
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      entityName: opts.entityName ?? null,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      details: opts.details,
    });
  } catch (err) {
    console.error("[Audit] Failed to write system event:", (err as Error).message);
  }
}

export async function logAction(opts: LogActionOptions): Promise<void> {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    adminUserId: opts.adminUserId,
    action: opts.action,
    entityType: opts.entityType,
    entityId: opts.entityId ?? null,
    ipAddress: opts.ipAddress ?? null,
    // Column is varchar(512) — a long or hostile UA must not fail the insert.
    userAgent: opts.userAgent?.slice(0, 512) ?? null,
    metadata: {
      actorName: opts.actorName,
      entityName: opts.entityName ?? null,
      ...opts.details,
    },
  });
}

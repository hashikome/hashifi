import type { AuditEntry, AuditList } from "@hashifi/types";
import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { Roles } from "../auth/staff-guard.js";
import { PrismaService } from "../database/prisma.service.js";
import { parseInput } from "../http/validation.js";

const auditQuery = z.object({
  entityType: z.string().trim().max(80).nullable().default(null),
  entityId: z.string().trim().max(80).nullable().default(null),
  staffId: z.uuid().nullable().default(null),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.uuid().nullable().default(null),
});

type Detail = string | number | boolean | null;

/** The audit trail, for admins. */
@Controller("api/audit")
@Roles("admin")
export class AuditController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  async list(@Query() query: unknown): Promise<AuditList> {
    const q = parseInput(auditQuery, query);
    const rows = await this.db.auditLog.findMany({
      where: {
        ...(q.entityType === null ? {} : { entityType: q.entityType }),
        ...(q.entityId === null ? {} : { entityId: q.entityId }),
        ...(q.staffId === null ? {} : { staffId: q.staffId }),
        ...(q.before === null ? {} : { id: { lt: q.before } }),
      },
      orderBy: { id: "desc" },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      entries: page.map(entryOf),
      nextBefore: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

function entryOf(row: {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  staffId: string | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: Date;
}): AuditEntry {
  const meta =
    typeof row.metadata === "object" && row.metadata !== null && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const { actorName, entityName, ...rest } = meta;
  const details: Record<string, Detail> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      details[key] = value as Detail;
    }
  }
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: typeof entityName === "string" ? entityName : null,
    staffId: row.staffId,
    actorName: typeof actorName === "string" ? actorName : "unknown",
    ipAddress: row.ipAddress,
    details,
    createdAt: row.createdAt.toISOString(),
  };
}

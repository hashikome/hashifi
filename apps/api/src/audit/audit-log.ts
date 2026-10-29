import { getLogger } from "@logtape/logtape";
import type { PrismaClient } from "../generated/prisma/client.js";

export type AuditDetails = Record<string, string | number | boolean | null>;

interface AuditEntry {
  adminUserId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  details: AuditDetails;
}

/** The internal audit trail (docs/SECURITY.md): who did what to which record. */
export class AuditLog {
  private readonly logger = getLogger(["hashifi", "audit"]);

  constructor(private readonly db: PrismaClient) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.auditLog.create({
      data: {
        adminUserId: entry.adminUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ipAddress: entry.ipAddress,
        // The column is varchar(512): a long or hostile user agent must not fail the insert.
        userAgent: entry.userAgent?.slice(0, 512) ?? null,
        metadata: { actorName: entry.actorName, entityName: entry.entityName, ...entry.details },
      },
    });
  }

  /**
   * Records something the system did on its own, such as a failed router push, with no admin
   * behind it. Never throws: an audit write must not take down the work it describes.
   */
  async system(
    action: string,
    entity: { type: string; id: string | null; name: string | null },
    details: AuditDetails = {},
  ): Promise<void> {
    try {
      await this.record({
        adminUserId: null,
        actorName: "system",
        action,
        entityType: entity.type,
        entityId: entity.id,
        entityName: entity.name,
        ipAddress: null,
        userAgent: null,
        details,
      });
    } catch (error) {
      this.logger.error("Failed to write a system audit event {action}", {
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

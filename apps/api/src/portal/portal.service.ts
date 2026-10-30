import type { PortalSettingsRecord } from "@hashifi/types";
import { Injectable } from "@nestjs/common";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { PrismaService } from "../database/prisma.service.js";
import { portalSettingsRecord } from "../serializers/records.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { DEFAULT_PORTAL_SETTINGS, type PortalInput } from "./portal-input.js";

/**
 * The portal's wording, colours and voucher defaults. HashiFi is used as it is, so there is
 * no uploaded branding: its logo and images ship with the web (`apps/web/public/`).
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
  ) {}

  async get(): Promise<PortalSettingsRecord> {
    const row = await this.db.portalSetting.findUnique({ where: { singleton: true } });
    return row === null ? DEFAULT_PORTAL_SETTINGS : portalSettingsRecord(row);
  }

  async save(
    staff: StaffPrincipal,
    input: PortalInput,
    origin: RequestOrigin,
  ): Promise<PortalSettingsRecord> {
    const row = await this.db.portalSetting.upsert({
      where: { singleton: true },
      create: input,
      update: input,
    });
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action: "portal_updated",
      entityType: "portal",
      entityId: row.id,
      entityName: row.brandName,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: {},
    });
    return portalSettingsRecord(row);
  }
}

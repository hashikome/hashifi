import type { VenueRecord } from "@hashifi/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { venueScope } from "../auth/venue-scope.js";
import { BrandService } from "../brand/brand.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { venueRecord } from "../serializers/records.js";
import type { VenueInput } from "./venue-input.js";

/** Where a change came from, for the audit trail. */
export interface RequestOrigin {
  ipAddress: string | null;
  userAgent: string | null;
}

export const venueNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That venue does not exist."));

@Injectable()
export class VenuesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly brand: BrandService,
  ) {}

  /** Newest first, each with its number of routers. */
  async list(staff: StaffPrincipal): Promise<VenueRecord[]> {
    const rows = await this.db.venue.findMany({
      where: venueScope(staff),
      include: { _count: { select: { routers: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => venueRecord(row, row._count.routers));
  }

  async get(staff: StaffPrincipal, id: string): Promise<VenueRecord> {
    const row = await this.db.venue.findFirst({
      where: { id, ...venueScope(staff) },
      include: { _count: { select: { routers: true } } },
    });
    if (!row) throw venueNotFound();
    return venueRecord(row, row._count.routers);
  }

  async create(
    staff: StaffPrincipal,
    input: VenueInput,
    origin: RequestOrigin,
  ): Promise<VenueRecord> {
    const row = await this.db.venue.create({ data: input });
    await this.record(staff, "venue_created", row.id, row.name, origin);
    return venueRecord(row, 0);
  }

  async update(
    staff: StaffPrincipal,
    id: string,
    input: VenueInput,
    origin: RequestOrigin,
  ): Promise<VenueRecord> {
    await this.get(staff, id);
    const row = await this.db.venue.update({
      where: { id },
      data: input,
      include: { _count: { select: { routers: true } } },
    });
    await this.record(staff, "venue_updated", row.id, row.name, origin);
    return venueRecord(row, row._count.routers);
  }

  /**
   * Refused while the venue has routers: deleting it would delete their records and tunnel
   * keys while the routers kept running, unmanaged.
   */
  async remove(staff: StaffPrincipal, id: string, origin: RequestOrigin): Promise<void> {
    const venue = await this.get(staff, id);
    if (venue.routerCount > 0) {
      throw new ConflictException(
        apiError("VENUE_HAS_ROUTERS", "Remove this venue's routers before deleting it."),
      );
    }
    await this.brand.forget(id);
    await this.db.venue.delete({ where: { id } });
    await this.record(staff, "venue_deleted", id, venue.name, origin);
  }

  private async record(
    staff: StaffPrincipal,
    action: string,
    entityId: string,
    entityName: string,
    origin: RequestOrigin,
  ): Promise<void> {
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action,
      entityType: "venue",
      entityId,
      entityName,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: {},
    });
  }
}

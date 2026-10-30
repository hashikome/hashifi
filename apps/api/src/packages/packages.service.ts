import type { PackageRecord, VenuePackages } from "@hashifi/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { packageRecord } from "../serializers/records.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { VenuesService } from "../venues/venues.service.js";
import type { PackageInput } from "./package-input.js";

/** Vouchers a package is still behind: deleting it would leave them without speed or time. */
const LIVE_VOUCHERS = ["unused", "pending_activation", "active"] as const;

export const packageNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That package does not exist."));

/**
 * Packages are one catalogue shared by every venue; a venue sells the ones assigned to it, or
 * every active one when none are assigned.
 */
@Injectable()
export class PackagesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly venues: VenuesService,
  ) {}

  /** Admins see the whole catalogue; managers only what can be sold. */
  async list(staff: StaffPrincipal): Promise<PackageRecord[]> {
    const rows = await this.db.package.findMany({
      where: staff.role === "admin" ? {} : { isActive: true },
      orderBy: [{ priceTsh: "asc" }, { createdAt: "asc" }],
    });
    return rows.map(packageRecord);
  }

  async get(staff: StaffPrincipal, id: string): Promise<PackageRecord> {
    const row = await this.db.package.findFirst({
      where: { id, ...(staff.role === "admin" ? {} : { isActive: true }) },
    });
    if (!row) throw packageNotFound();
    return packageRecord(row);
  }

  async create(staff: StaffPrincipal, input: PackageInput, origin: RequestOrigin) {
    const row = await this.db.package.create({ data: input });
    await this.record(staff, "package_created", row.id, row.name, origin);
    return packageRecord(row);
  }

  /**
   * Issued vouchers keep the duration and price they were sold with; a speed change reaches
   * the routers at their next sync.
   */
  async update(staff: StaffPrincipal, id: string, input: PackageInput, origin: RequestOrigin) {
    await this.get(staff, id);
    const row = await this.db.package.update({ where: { id }, data: input });
    await this.record(staff, "package_updated", row.id, row.name, origin);
    return packageRecord(row);
  }

  /** Refused while vouchers depend on it; deactivating takes it off sale instead. */
  async remove(staff: StaffPrincipal, id: string, origin: RequestOrigin): Promise<void> {
    const pkg = await this.get(staff, id);
    const live = await this.db.voucher.count({
      where: { packageId: id, status: { in: [...LIVE_VOUCHERS] } },
    });
    if (live > 0) {
      throw new ConflictException(
        apiError(
          "PACKAGE_IN_USE",
          `${live} voucher${live === 1 ? " uses" : "s use"} this package. Deactivate it to stop selling it.`,
        ),
      );
    }
    await this.db.package.delete({ where: { id } });
    await this.record(staff, "package_deleted", id, pkg.name, origin);
  }

  /** What a venue sells: its assigned packages that are active, or every active package. */
  async soldAt(staff: StaffPrincipal, venueId: string): Promise<VenuePackages> {
    await this.venues.get(staff, venueId);
    const assigned = await this.db.venuePackage.findMany({
      where: { venueId },
      select: { packageId: true },
    });
    const assignedPackageIds = assigned.map((a) => a.packageId);
    const sellsAll = assignedPackageIds.length === 0;
    const rows = await this.db.package.findMany({
      where: { isActive: true, ...(sellsAll ? {} : { id: { in: assignedPackageIds } }) },
      orderBy: [{ priceTsh: "asc" }, { createdAt: "asc" }],
    });
    return { packages: rows.map(packageRecord), assignedPackageIds, sellsAll };
  }

  /** Puts a package on sale at a venue. Idempotent. */
  async assign(staff: StaffPrincipal, venueId: string, packageId: string, origin: RequestOrigin) {
    const venue = await this.venues.get(staff, venueId);
    const pkg = await this.get(staff, packageId);
    await this.db.venuePackage.upsert({
      where: { venueId_packageId: { venueId, packageId } },
      create: { venueId, packageId },
      update: {},
    });
    await this.record(staff, "package_assigned", packageId, pkg.name, origin, {
      venueId,
      venueName: venue.name,
    });
    return this.soldAt(staff, venueId);
  }

  /** Takes a package off sale at a venue. Idempotent. */
  async unassign(staff: StaffPrincipal, venueId: string, packageId: string, origin: RequestOrigin) {
    const venue = await this.venues.get(staff, venueId);
    const removed = await this.db.venuePackage.deleteMany({ where: { venueId, packageId } });
    if (removed.count > 0) {
      await this.record(staff, "package_unassigned", packageId, null, origin, {
        venueId,
        venueName: venue.name,
      });
    }
    return this.soldAt(staff, venueId);
  }

  private async record(
    staff: StaffPrincipal,
    action: string,
    entityId: string,
    entityName: string | null,
    origin: RequestOrigin,
    details: Record<string, string> = {},
  ): Promise<void> {
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action,
      entityType: "package",
      entityId,
      entityName,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details,
    });
  }
}

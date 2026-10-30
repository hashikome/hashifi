import { createHash } from "node:crypto";
import type { BrandRecord, VenueBrandResponse } from "@hashifi/types";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { venueScope } from "../auth/venue-scope.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Venue, VenueBrand } from "../generated/prisma/client.js";
import { apiError } from "../http/error-envelope.js";
import { captureFailure } from "../observability/telemetry.js";
import { PortalService } from "../portal/portal.service.js";
import type { BrandInput } from "../portal/portal-input.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { type BrandImageKind, NotAnImageError, processBrandImage } from "./brand-images.js";
import { BRAND_STORE, type BrandStore } from "./brand-store.js";

const FILE = /^(logo|background)-[0-9a-f]{16}\.webp$/;

const venueNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That venue does not exist."));

/** Where a guest's phone loads an image: the portal's own origin, the one host it can reach. */
function urlOf(key: string | null): string | null {
  return key === null ? null : `/api/guest/brand/${key}`;
}

/**
 * What each venue shows: its own branding, or the HashiFi default. A manager brands the venues
 * they operate; outside them a venue is not found.
 */
@Injectable()
export class BrandService {
  constructor(
    private readonly db: PrismaService,
    private readonly portal: PortalService,
    private readonly audit: AuditLog,
    @Inject(BRAND_STORE) private readonly store: BrandStore,
  ) {}

  /** What a venue shows. Null is a voucher with no venue: the HashiFi default. */
  async resolve(venueId: string | null): Promise<BrandRecord> {
    const row =
      venueId === null ? null : await this.db.venueBrand.findUnique({ where: { venueId } });
    const defaults = await this.portal.get();
    if (row === null) return { ...defaults, logoUrl: null, backgroundUrl: null };
    return {
      ...defaults,
      brandName: row.brandName,
      headline: row.headline,
      message: row.message,
      primaryColor: row.primaryColor,
      accentColor: row.accentColor,
      backgroundColor: row.backgroundColor,
      radius: row.radius,
      voucherLabel: row.voucherLabel,
      voucherPrefix: row.voucherPrefix,
      voucherHelp: row.voucherHelp,
      ticketTitle: row.ticketTitle,
      ticketFooter: row.ticketFooter,
      requireTerms: row.requireTerms,
      updatedAt: row.updatedAt.toISOString(),
      logoUrl: urlOf(row.logoKey),
      backgroundUrl: urlOf(row.backgroundKey),
    };
  }

  async ofVenue(staff: StaffPrincipal, id: string): Promise<VenueBrandResponse> {
    await this.venueOf(staff, id);
    return this.response(id);
  }

  async save(
    staff: StaffPrincipal,
    id: string,
    input: BrandInput,
    origin: RequestOrigin,
  ): Promise<VenueBrandResponse> {
    const venue = await this.venueOf(staff, id);
    await this.db.venueBrand.upsert({
      where: { venueId: id },
      create: { venueId: id, ...input },
      update: input,
    });
    await this.record(staff, "brand_updated", venue, origin);
    return this.response(id);
  }

  /** Back to the HashiFi default; the venue's images go too. */
  async reset(
    staff: StaffPrincipal,
    id: string,
    origin: RequestOrigin,
  ): Promise<VenueBrandResponse> {
    const venue = await this.venueOf(staff, id);
    await this.forget(id);
    await this.record(staff, "brand_reset", venue, origin);
    return this.response(id);
  }

  async putImage(
    staff: StaffPrincipal,
    id: string,
    kind: BrandImageKind,
    upload: Uint8Array,
    origin: RequestOrigin,
  ): Promise<VenueBrandResponse> {
    const venue = await this.venueOf(staff, id);
    const bytes = await processBrandImage(upload, kind).catch((err: unknown) => {
      if (!(err instanceof NotAnImageError)) throw err;
      throw new BadRequestException(apiError("INVALID_IMAGE", "Upload a JPEG, PNG or WebP image."));
    });
    // Named by its content, so a phone can cache it for good and a new file gets a new address.
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const key = `${id}/${kind}-${hash}.webp`;
    await this.store.put(key, bytes);

    const before = await this.db.venueBrand.findUnique({ where: { venueId: id } });
    const column = kind === "logo" ? { logoKey: key } : { backgroundKey: key };
    if (before === null) {
      // The venue had no branding: the image starts it, from what it was showing.
      const { isActive: _active, updatedAt: _updated, ...defaults } = await this.portal.get();
      await this.db.venueBrand.create({ data: { venueId: id, ...defaults, ...column } });
    } else {
      await this.db.venueBrand.update({ where: { venueId: id }, data: column });
      const old = keyOf(before, kind);
      if (old !== null && old !== key) this.discard(old);
    }
    await this.record(staff, `brand_${kind}_uploaded`, venue, origin);
    return this.response(id);
  }

  async removeImage(
    staff: StaffPrincipal,
    id: string,
    kind: BrandImageKind,
    origin: RequestOrigin,
  ): Promise<VenueBrandResponse> {
    const venue = await this.venueOf(staff, id);
    const row = await this.db.venueBrand.findUnique({ where: { venueId: id } });
    const key = row === null ? null : keyOf(row, kind);
    if (key !== null) {
      await this.db.venueBrand.update({
        where: { venueId: id },
        data: kind === "logo" ? { logoKey: null } : { backgroundKey: null },
      });
      this.discard(key);
      await this.record(staff, `brand_${kind}_removed`, venue, origin);
    }
    return this.response(id);
  }

  /** An image, for the public route. Only a name this service makes is ever looked up. */
  async image(venueId: string, file: string): Promise<Uint8Array | null> {
    return FILE.test(file) ? this.store.get(`${venueId}/${file}`) : null;
  }

  /** Removes a venue's branding and files, as the venue is deleted or reset. */
  async forget(venueId: string): Promise<void> {
    const row = await this.db.venueBrand.findUnique({ where: { venueId } });
    if (row === null) return;
    await this.db.venueBrand.delete({ where: { venueId } });
    for (const key of [row.logoKey, row.backgroundKey]) {
      if (key !== null) this.discard(key);
    }
  }

  /** An orphaned file costs a few kilobytes; a failed delete never fails the request. */
  private discard(key: string): void {
    void this.store.remove(key).catch(captureFailure);
  }

  private async response(id: string): Promise<VenueBrandResponse> {
    const count = await this.db.venueBrand.count({ where: { venueId: id } });
    return { brand: await this.resolve(id), isCustom: count > 0 };
  }

  private async venueOf(staff: StaffPrincipal, id: string): Promise<Venue> {
    const venue = await this.db.venue.findFirst({ where: { id, ...venueScope(staff) } });
    if (venue === null) throw venueNotFound();
    return venue;
  }

  private async record(
    staff: StaffPrincipal,
    action: string,
    venue: Venue,
    origin: RequestOrigin,
  ): Promise<void> {
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action,
      entityType: "venue",
      entityId: venue.id,
      entityName: venue.name,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: {},
    });
  }
}

function keyOf(row: VenueBrand, kind: BrandImageKind): string | null {
  return kind === "logo" ? row.logoKey : row.backgroundKey;
}

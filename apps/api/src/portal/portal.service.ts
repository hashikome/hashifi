import type { PortalImageResponse, PortalSettingsRecord } from "@hashifi/types";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { portalSettingsRecord } from "../serializers/records.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { type PortalImageKind, processPortalImage } from "./portal-images.js";
import {
  DEFAULT_PORTAL_SETTINGS,
  IMAGE_PATH,
  imageIdOf,
  type PortalInput,
} from "./portal-input.js";

/** An upload not yet saved into the settings survives this long, for the admin to press Save. */
const UNSAVED_IMAGE_GRACE_MS = 24 * 60 * 60 * 1000;

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

  /**
   * Saves the whole branding. Each image must be one uploaded here, of the right kind; images
   * no longer used are deleted, except uploads from the last day that may be awaiting a save.
   */
  async save(
    staff: StaffPrincipal,
    input: PortalInput,
    origin: RequestOrigin,
  ): Promise<PortalSettingsRecord> {
    await this.checkImage("logoUrl", input.logoUrl, "logo");
    await this.checkImage("backgroundImageUrl", input.backgroundImageUrl, "background");
    const row = await this.db.portalSetting.upsert({
      where: { singleton: true },
      create: input,
      update: input,
    });
    const keep = [imageIdOf(row.logoUrl), imageIdOf(row.backgroundImageUrl)].filter(
      (id) => id !== null,
    );
    await this.db.portalImage.deleteMany({
      where: {
        id: { notIn: keep },
        createdAt: { lt: new Date(Date.now() - UNSAVED_IMAGE_GRACE_MS) },
      },
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

  /** Re-encodes and stores an image; it shows on the portal once saved into the settings. */
  async upload(kind: PortalImageKind, body: Buffer): Promise<PortalImageResponse> {
    let bytes: Buffer;
    try {
      bytes = await processPortalImage(body, kind);
    } catch {
      throw new BadRequestException(
        apiError("INVALID_IMAGE", "Upload a JPEG, PNG, WebP or GIF image."),
      );
    }
    const image = await this.db.portalImage.create({
      data: { kind, contentType: "image/jpeg", bytes: new Uint8Array(bytes) },
      select: { id: true },
    });
    return { id: image.id, kind, url: `${IMAGE_PATH}${image.id}` };
  }

  async image(id: string): Promise<{ contentType: string; bytes: Uint8Array }> {
    const image = await this.db.portalImage.findUnique({
      where: { id },
      select: { contentType: true, bytes: true },
    });
    if (!image) throw new NotFoundException(apiError("NOT_FOUND", "Not found."));
    return image;
  }

  private async checkImage(field: string, url: string | null, kind: PortalImageKind) {
    const id = imageIdOf(url);
    if (id === null) return;
    const image = await this.db.portalImage.findUnique({ where: { id }, select: { kind: true } });
    if (image?.kind !== kind) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          [field]: `must be a ${kind} uploaded here`,
        }),
      );
    }
  }
}

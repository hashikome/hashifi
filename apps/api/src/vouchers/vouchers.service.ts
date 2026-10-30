import type {
  PrintableVoucher,
  VoucherBatchDetail,
  VoucherBatchRecord,
  VoucherList,
  VoucherStatus,
} from "@hashifi/types";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { z } from "zod";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { venueScope } from "../auth/venue-scope.js";
import { BrandService } from "../brand/brand.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma, type Voucher } from "../generated/prisma/client.js";
import type { VoucherWhereInput } from "../generated/prisma/models.js";
import { apiError } from "../http/error-envelope.js";
import { captureFailure } from "../observability/telemetry.js";
import { PackagesService } from "../packages/packages.service.js";
import { voucherRecord } from "../serializers/records.js";
import { RouterSync } from "../services/router-sync.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { generateCodes } from "./voucher-codes.js";
import type { BatchInput, listQuery } from "./voucher-input.js";

const DAY_MS = 86_400_000;
/** Only cards nobody has used: revoking never cuts off a guest who paid. */
const REVOCABLE = ["unused"] as const;
const STATUSES: VoucherStatus[] = [
  "unused",
  "pending_activation",
  "active",
  "expired",
  "used",
  "revoked",
];

const batchNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That batch does not exist."));

/** Vouchers or batches in the staff member's venues; admins also see ones whose venue is gone. */
function inScope(staff: StaffPrincipal) {
  return staff.role === "admin" ? {} : { venue: { is: venueScope(staff) } };
}

@Injectable()
export class VouchersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly sync: RouterSync,
    private readonly packages: PackagesService,
    private readonly brand: BrandService,
  ) {}

  async list(staff: StaffPrincipal, query: z.infer<typeof listQuery>): Promise<VoucherList> {
    const where: VoucherWhereInput = {
      ...inScope(staff),
      ...(query.venueId === null ? {} : { venueId: query.venueId }),
      ...(query.batchId === null ? {} : { batchId: query.batchId }),
      ...(query.status === null ? {} : { status: query.status }),
      ...(query.before === null ? {} : { id: { lt: query.before } }),
    };
    const rows = await this.db.voucher.findMany({
      where,
      include: { package: { select: { name: true } }, venue: { select: { name: true } } },
      orderBy: { id: "desc" },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      vouchers: page.map((row) => ({
        ...voucherRecord(row),
        packageName: row.package?.name ?? null,
        venueName: row.venue?.name ?? null,
      })),
      nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async batches(staff: StaffPrincipal): Promise<VoucherBatchRecord[]> {
    const rows = await this.db.voucherBatch.findMany({
      where: inScope(staff),
      include: batchInclude,
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(rows.map((row) => this.batchRecord(row)));
  }

  async batch(staff: StaffPrincipal, id: string): Promise<VoucherBatchDetail> {
    const row = await this.db.voucherBatch.findFirst({
      where: { id, ...inScope(staff) },
      include: batchInclude,
    });
    if (!row) throw batchNotFound();
    const vouchers = await this.db.voucher.findMany({
      where: { batchId: id },
      include: {
        package: { select: { name: true, downloadSpeedMbps: true, uploadSpeedMbps: true } },
      },
      orderBy: { code: "asc" },
    });
    const printable = vouchers.map((voucher) => printableOf(voucher, row.venue?.name ?? null));
    return { batch: await this.batchRecord(row), vouchers: printable };
  }

  /** Chosen vouchers with what their cards show, for reprinting; in scope only. */
  async printable(staff: StaffPrincipal, ids: string[]): Promise<PrintableVoucher[]> {
    const rows = await this.db.voucher.findMany({
      where: { id: { in: ids }, ...inScope(staff) },
      include: {
        package: { select: { name: true, downloadSpeedMbps: true, uploadSpeedMbps: true } },
        venue: { select: { name: true } },
      },
      orderBy: { code: "asc" },
    });
    return rows.map((row) => printableOf(row, row.venue?.name ?? null));
  }

  /**
   * Makes a batch of vouchers for a package the venue sells, and pushes them to its routers in
   * the background. A voucher is `unused` until a guest redeems it and the router confirms it;
   * a router that misses the push gets the code when it is redeemed.
   */
  async createBatch(
    staff: StaffPrincipal,
    input: BatchInput,
    origin: RequestOrigin,
  ): Promise<VoucherBatchDetail> {
    const sold = await this.packages.soldAt(staff, input.venueId);
    const pkg = sold.packages.find((p) => p.id === input.packageId) ?? null;
    if (pkg === null) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          packageId: "is not on sale at this venue",
        }),
      );
    }
    const prefix = input.prefix ?? (await this.brand.resolve(input.venueId)).voucherPrefix;
    const expiresAt =
      input.expiryDays === null ? null : new Date(Date.now() + input.expiryDays * DAY_MS);

    const { batchId, codes } = await this.insertBatch(staff, input, prefix, expiresAt);
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action: "vouchers_generated",
      entityType: "voucher_batch",
      entityId: batchId,
      entityName: pkg.name,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: { quantity: input.quantity, venueId: input.venueId, prefix },
    });

    const row = await this.db.package.findUniqueOrThrow({ where: { id: input.packageId } });
    void this.sync.pushVouchers(input.venueId, codes, row, row.dataLimitGb).catch(captureFailure);
    return this.batch(staff, batchId);
  }

  /**
   * Revokes unused vouchers, such as lost or stolen cards: they stop working and are taken off
   * the venue's routers, and stay on record. Redeemed or finished vouchers are left as they
   * are, so this never cuts off a guest who paid.
   */
  async revoke(staff: StaffPrincipal, ids: string[], origin: RequestOrigin) {
    const targets = await this.db.voucher.findMany({
      where: { id: { in: ids }, status: { in: [...REVOCABLE] }, ...inScope(staff) },
      select: { id: true, code: true, venueId: true },
    });
    if (targets.length === 0) return { revoked: 0 };
    const now = new Date();
    const targetIds = targets.map((v) => v.id);
    await this.db.voucher.updateMany({
      where: { id: { in: targetIds }, status: { in: [...REVOCABLE] } },
      data: { status: "revoked", revokedAt: now },
    });
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action: "vouchers_revoked",
      entityType: "voucher",
      entityId: targets.length === 1 ? (targets[0]?.id ?? null) : null,
      entityName: null,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: { count: targets.length },
    });
    const byVenue = new Map<string, string[]>();
    for (const voucher of targets) {
      if (voucher.venueId === null) continue;
      byVenue.set(voucher.venueId, [...(byVenue.get(voucher.venueId) ?? []), voucher.code]);
    }
    for (const [venueId, codes] of byVenue) {
      void this.sync.removeVouchers(venueId, codes).catch(captureFailure);
    }
    return { revoked: targets.length };
  }

  /** Inserts the batch and its codes in one transaction; a code taken meanwhile is retried. */
  private async insertBatch(
    staff: StaffPrincipal,
    input: BatchInput,
    prefix: string,
    expiresAt: Date | null,
  ): Promise<{ batchId: string; codes: string[] }> {
    const pkg = await this.db.package.findUniqueOrThrow({ where: { id: input.packageId } });
    for (let attempt = 0; attempt < 3; attempt++) {
      const codes = await generateCodes(prefix, input.quantity, async (candidates) => {
        const taken = await this.db.voucher.findMany({
          where: { code: { in: candidates } },
          select: { code: true },
        });
        return new Set(taken.map((v) => v.code));
      });
      try {
        const batchId = await this.db.$transaction(async (tx) => {
          const batch = await tx.voucherBatch.create({
            data: {
              packageId: input.packageId,
              venueId: input.venueId,
              createdById: staff.id,
              quantity: input.quantity,
              prefix,
              expiresAt,
            },
          });
          await tx.voucher.createMany({
            data: codes.map((code) => ({
              batchId: batch.id,
              packageId: pkg.id,
              venueId: input.venueId,
              code,
              dataLimitGb: pkg.dataLimitGb,
              durationMinutes: pkg.durationMinutes,
              priceTsh: pkg.priceTsh,
              expiresAt,
            })),
          });
          return batch.id;
        });
        return { batchId, codes };
      } catch (err) {
        const collided =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
        if (!collided) throw err;
      }
    }
    throw new Error("Could not insert a voucher batch with unique codes");
  }

  private async batchRecord(row: BatchRow): Promise<VoucherBatchRecord> {
    const grouped = await this.db.voucher.groupBy({
      by: ["status"],
      where: { batchId: row.id },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<VoucherStatus, number>;
    for (const group of grouped) counts[group.status] = group._count._all;
    return {
      id: row.id,
      venueId: row.venueId,
      venueName: row.venue?.name ?? null,
      packageId: row.packageId,
      packageName: row.package?.name ?? null,
      createdById: row.createdById,
      quantity: row.quantity,
      prefix: row.prefix,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      counts,
    };
  }
}

const batchInclude = {
  venue: { select: { name: true } },
  package: { select: { name: true } },
} as const;

type BatchRow = Prisma.VoucherBatchGetPayload<{ include: typeof batchInclude }>;

type PrintRow = Voucher & {
  package: { name: string; downloadSpeedMbps: number; uploadSpeedMbps: number | null } | null;
};

function printableOf(row: PrintRow, venueName: string | null): PrintableVoucher {
  return {
    ...voucherRecord(row),
    packageName: row.package?.name ?? null,
    venueName,
    downloadSpeedMbps: row.package?.downloadSpeedMbps ?? null,
    uploadSpeedMbps: row.package?.uploadSpeedMbps ?? row.package?.downloadSpeedMbps ?? null,
  };
}

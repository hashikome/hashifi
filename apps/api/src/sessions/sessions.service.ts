import type { SessionList, SessionRecord } from "@hashifi/types";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { PrismaService } from "../database/prisma.service.js";
import type { WifiSessionWhereInput } from "../generated/prisma/models.js";
import { apiError } from "../http/error-envelope.js";
import { captureFailure } from "../observability/telemetry.js";
import { bytes, sessionRecord } from "../serializers/records.js";
import { RouterSync } from "../services/router-sync.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { sessionScope } from "./session-scope.js";

export const sessionQuery = z.object({
  status: z.enum(["connected", "disconnected", "expired", "terminated"]).nullable().default(null),
  venueId: z.uuid().nullable().default(null),
  deviceId: z.uuid().nullable().default(null),
  search: z.string().trim().max(80).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.uuid().nullable().default(null),
});

export const sessionInclude = {
  voucher: { select: { code: true } },
  package: { select: { name: true } },
  venue: { select: { name: true } },
  router: { select: { name: true } },
} as const;

@Injectable()
export class SessionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly sync: RouterSync,
  ) {}

  async list(staff: StaffPrincipal, query: z.infer<typeof sessionQuery>): Promise<SessionList> {
    const search = query.search === null || query.search === "" ? null : query.search;
    const where: WifiSessionWhereInput = {
      ...sessionScope(staff),
      ...(query.status === null ? {} : { status: query.status }),
      ...(query.venueId === null ? {} : { venueId: query.venueId }),
      ...(query.deviceId === null ? {} : { deviceId: query.deviceId }),
      ...(search === null
        ? {}
        : {
            OR: [
              { macAddress: { contains: search, mode: "insensitive" } },
              { ipAddress: { contains: search } },
              { deviceName: { contains: search, mode: "insensitive" } },
            ],
          }),
    };
    const [rows, total, connected, sums] = await Promise.all([
      this.db.wifiSession.findMany({
        where: query.before === null ? where : { AND: [where, { id: { lt: query.before } }] },
        include: sessionInclude,
        orderBy: { id: "desc" },
        take: query.limit + 1,
      }),
      this.db.wifiSession.count({ where }),
      this.db.wifiSession.count({ where: { AND: [where, { status: "connected" }] } }),
      this.db.wifiSession.aggregate({ where, _sum: { uploadBytes: true, downloadBytes: true } }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      sessions: page.map(sessionRecord),
      nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      stats: {
        total,
        connected,
        uploadBytes: bytes(sums._sum.uploadBytes ?? 0n),
        downloadBytes: bytes(sums._sum.downloadBytes ?? 0n),
      },
    };
  }

  async get(staff: StaffPrincipal, id: string): Promise<SessionRecord> {
    const row = await this.db.wifiSession.findFirst({
      where: { id, ...sessionScope(staff) },
      include: sessionInclude,
    });
    if (!row) throw new NotFoundException(apiError("NOT_FOUND", "That session does not exist."));
    return sessionRecord(row);
  }

  /**
   * Ends a session and drops it from the venue's routers. The voucher stays valid, so the
   * device can sign in again; to stop it, block the device.
   */
  async terminate(staff: StaffPrincipal, id: string, origin: RequestOrigin) {
    const session = await this.get(staff, id);
    const ended = await this.end([id], "staff_disconnect");
    if (ended === 0) {
      throw new ConflictException(
        apiError("SESSION_NOT_ACTIVE", "That session has already ended."),
      );
    }
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action: "session_terminated",
      entityType: "session",
      entityId: id,
      entityName: session.venueName,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: {},
    });
    return this.get(staff, id);
  }

  /**
   * Marks connected sessions terminated and takes their vouchers' devices off the routers in the
   * background, forgetting them so that the router does not sign them back in. Returns how many
   * were still connected.
   */
  async end(ids: string[], reason: string): Promise<number> {
    const now = new Date();
    const connected = await this.db.wifiSession.findMany({
      where: { id: { in: ids }, status: "connected" },
      include: { voucher: { select: { code: true } } },
    });
    let ended = 0;
    for (const session of connected) {
      const updated = await this.db.wifiSession.updateMany({
        where: { id: session.id, status: "connected" },
        data: {
          status: "terminated",
          endedAt: now,
          terminationReason: reason,
          durationSeconds: Math.max(
            0,
            Math.floor((now.getTime() - session.startedAt.getTime()) / 1000),
          ),
        },
      });
      ended += updated.count;
      const code = session.voucher?.code ?? null;
      if (updated.count === 1 && code !== null && session.venueId !== null) {
        void this.sync
          .disconnectDevice(session.venueId, code, session.macAddress)
          .catch(captureFailure);
      }
    }
    return ended;
  }
}

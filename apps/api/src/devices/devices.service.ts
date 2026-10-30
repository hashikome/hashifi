import type { DeviceList, DeviceRecord } from "@hashifi/types";
import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Device } from "../generated/prisma/client.js";
import type { DeviceWhereInput } from "../generated/prisma/models.js";
import { apiError } from "../http/error-envelope.js";
import { bytes } from "../serializers/records.js";
import { sessionScope } from "../sessions/session-scope.js";
import { SessionsService } from "../sessions/sessions.service.js";
import type { RequestOrigin } from "../venues/venues.service.js";

export const deviceQuery = z.object({
  status: z.enum(["online", "offline", "blocked"]).nullable().default(null),
  search: z.string().trim().max(80).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.uuid().nullable().default(null),
});

export const deviceStatusInput = z.object({ status: z.enum(["active", "blocked"]) });

const deviceNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That device does not exist."));

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly sessions: SessionsService,
  ) {}

  async list(staff: StaffPrincipal, query: z.infer<typeof deviceQuery>): Promise<DeviceList> {
    const search = query.search === null || query.search === "" ? null : query.search;
    const scope = this.scope(staff);
    const online: DeviceWhereInput = {
      status: "active",
      sessions: { some: { ...sessionScope(staff), status: "connected" } },
    };
    const byStatus: Record<"online" | "offline" | "blocked", DeviceWhereInput> = {
      online,
      offline: { status: "active", NOT: online },
      blocked: { status: "blocked" },
    };
    const filters: DeviceWhereInput[] = [scope];
    if (search !== null) {
      filters.push({
        OR: [
          { macAddress: { contains: search, mode: "insensitive" } },
          { deviceName: { contains: search, mode: "insensitive" } },
        ],
      });
    }
    if (query.status !== null) filters.push(byStatus[query.status]);
    const where: DeviceWhereInput = { AND: filters };

    const [rows, total, onlineCount, blocked] = await Promise.all([
      this.db.device.findMany({
        where: query.before === null ? where : { AND: [where, { id: { lt: query.before } }] },
        orderBy: { id: "desc" },
        take: query.limit + 1,
      }),
      this.db.device.count({ where: scope }),
      this.db.device.count({ where: { AND: [scope, online] } }),
      this.db.device.count({ where: { AND: [scope, byStatus.blocked] } }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      devices: await this.records(staff, page),
      nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      stats: { total, online: onlineCount, offline: total - onlineCount - blocked, blocked },
    };
  }

  async get(staff: StaffPrincipal, id: string): Promise<DeviceRecord> {
    const row = await this.db.device.findFirst({ where: { id, ...this.scope(staff) } });
    if (!row) throw deviceNotFound();
    const [record] = await this.records(staff, [row]);
    if (!record) throw deviceNotFound();
    return record;
  }

  /**
   * Blocks or unblocks a device. Blocking ends its sessions everywhere at once; the portal
   * refuses a blocked device from M5.
   */
  async setStatus(
    staff: StaffPrincipal,
    id: string,
    status: "active" | "blocked",
    origin: RequestOrigin,
  ): Promise<DeviceRecord> {
    await this.get(staff, id);
    await this.db.device.update({ where: { id }, data: { status } });
    if (status === "blocked") {
      const connected = await this.db.wifiSession.findMany({
        where: { deviceId: id, status: "connected" },
        select: { id: true },
      });
      await this.sessions.end(
        connected.map((s) => s.id),
        "device_blocked",
      );
    }
    await this.record(
      staff,
      status === "blocked" ? "device_blocked" : "device_unblocked",
      id,
      origin,
    );
    return this.get(staff, id);
  }

  /** Forgets a device (a MAC address is personal data); its sessions stay, unlinked. */
  async remove(staff: StaffPrincipal, id: string, origin: RequestOrigin): Promise<void> {
    await this.get(staff, id);
    await this.db.device.delete({ where: { id } });
    await this.record(staff, "device_deleted", id, origin);
  }

  private scope(staff: StaffPrincipal): DeviceWhereInput {
    return staff.role === "admin" ? {} : { sessions: { some: sessionScope(staff) } };
  }

  /** Usage and online state, counted over the sessions the staff member may see. */
  private async records(staff: StaffPrincipal, rows: Device[]): Promise<DeviceRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [usage, connected] = await Promise.all([
      this.db.wifiSession.groupBy({
        by: ["deviceId"],
        where: { deviceId: { in: ids }, ...sessionScope(staff) },
        _sum: { uploadBytes: true, downloadBytes: true },
      }),
      this.db.wifiSession.findMany({
        where: { deviceId: { in: ids }, status: "connected", ...sessionScope(staff) },
        select: { deviceId: true },
        distinct: ["deviceId"],
      }),
    ]);
    const usageOf = new Map(usage.map((u) => [u.deviceId, u._sum]));
    const onlineIds = new Set(connected.map((c) => c.deviceId));
    return rows.map((row) => ({
      id: row.id,
      macAddress: row.macAddress,
      lastIpAddress: row.lastIpAddress,
      deviceName: row.deviceName,
      deviceType: row.deviceType,
      status: row.status,
      isOnline: row.status === "active" && onlineIds.has(row.id),
      downloadBytes: bytes(usageOf.get(row.id)?.downloadBytes ?? 0n),
      uploadBytes: bytes(usageOf.get(row.id)?.uploadBytes ?? 0n),
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    }));
  }

  private async record(
    staff: StaffPrincipal,
    action: string,
    id: string,
    origin: RequestOrigin,
  ): Promise<void> {
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action,
      entityType: "device",
      entityId: id,
      // Not the MAC address: the audit trail names records, it does not collect personal data.
      entityName: null,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details: {},
    });
  }
}

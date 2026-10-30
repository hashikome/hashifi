import type { BootstrapScriptResponse, ProvisioningBacklog, RouterRecord } from "@hashifi/types";
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";
import { AuditLog } from "../audit/audit-log.js";
import type { StaffPrincipal } from "../auth/staff-guard.js";
import { venueScope } from "../auth/venue-scope.js";
import type { AppConfig } from "../config/config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { toJsonValue } from "../database/json.js";
import { PrismaService } from "../database/prisma.service.js";
import { apiError } from "../http/error-envelope.js";
import { captureFailure } from "../observability/telemetry.js";
import { routerRecord } from "../serializers/records.js";
import { RouterError } from "../services/mikrotik-errors.js";
import { RouterAccess } from "../services/router-credentials.js";
import { RouterLogger } from "../services/router-log.js";
import { buildBootstrapScript } from "../services/router-provision/bootstrap.js";
import {
  buildHotspotPlan,
  type HotspotPlan,
  isRadioInterfaceType,
  resolveBackendEndpoints,
} from "../services/router-provision/context.js";
import { dialectFor } from "../services/router-provision/dialect.js";
import { type ProvisionReport, provisionRouter } from "../services/router-provision/index.js";
import { PrismaRouterStore } from "../services/router-provision/prisma-store.js";
import { probeRouterMerged, type RouterProfile } from "../services/router-provision/probe.js";
import { probeReadiness, type ReadinessReport } from "../services/router-provision/readiness.js";
import { type SetupReport, setupRouter } from "../services/router-provision/setup.js";
import { probeVerify, type VerifyReport } from "../services/router-provision/verify.js";
import { RouterSync } from "../services/router-sync.js";
import type { RequestOrigin } from "../venues/venues.service.js";
import { VoucherReconciler } from "../vouchers/voucher-reconciler.js";
import { backendSettings } from "./backend-settings.js";
import type { bootstrapInput, RouterInput, testConnectionInput } from "./router-input.js";
import { TUNNEL_ALLOCATOR, type TunnelAllocator } from "./tunnel-allocator.js";

const withVenue = { venue: { select: { name: true } } } as const;

export const routerNotFound = () =>
  new NotFoundException(apiError("NOT_FOUND", "That router does not exist."));

/** A probe of a saved router: what it is, and whether the site is ready for setup. */
export interface ProbeResult {
  runId: string;
  profile: RouterProfile;
  plan: HotspotPlan | null;
  planError: string | null;
  readiness: ReadinessReport | null;
  log: readonly unknown[];
}

@Injectable()
export class RoutersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditLog,
    private readonly access: RouterAccess,
    private readonly sync: RouterSync,
    private readonly store: PrismaRouterStore,
    private readonly reconciler: VoucherReconciler,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TUNNEL_ALLOCATOR) private readonly tunnels: TunnelAllocator | null,
  ) {}

  async list(staff: StaffPrincipal, venueId: string | null): Promise<RouterRecord[]> {
    const rows = await this.db.router.findMany({
      where: { venue: venueScope(staff), ...(venueId === null ? {} : { venueId }) },
      include: withVenue,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => routerRecord(row, staff.role));
  }

  async get(staff: StaffPrincipal, id: string): Promise<RouterRecord> {
    return routerRecord(await this.row(staff, id), staff.role);
  }

  backlog(staff: StaffPrincipal): Promise<ProvisioningBacklog> {
    return this.reconciler.backlog(venueScope(staff));
  }

  async create(
    staff: StaffPrincipal,
    input: RouterInput,
    origin: RequestOrigin,
  ): Promise<RouterRecord> {
    await this.checkVenue(staff, input.venueId);
    const { apiPassword, ...fields } = input;
    const row = await this.db.router.create({
      data: {
        ...fields,
        apiPasswordEncrypted: apiPassword === null ? null : this.access.sealPassword(apiPassword),
      },
      include: withVenue,
    });
    await this.record(staff, "router_created", row.id, row.name, origin);
    // Nobody waits on this: a router that is not reachable yet is the normal case before its
    // bootstrap script is pasted. `syncRouter` records its own failures.
    void this.sync.syncRouter(row.id).catch(captureFailure);
    return routerRecord(row, staff.role);
  }

  /**
   * Replaces the router's settings, keeping the stored API password when none is given. The
   * venue cannot change: the router holds that venue's vouchers as hotspot users.
   */
  async update(
    staff: StaffPrincipal,
    id: string,
    input: RouterInput,
    origin: RequestOrigin,
  ): Promise<RouterRecord> {
    const existing = await this.row(staff, id);
    if (input.venueId !== existing.venueId) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          venueId: "cannot change; remove the router and add it to the other venue",
        }),
      );
    }
    const { apiPassword, ...fields } = input;
    const row = await this.db.router.update({
      where: { id },
      data: {
        ...fields,
        ...(apiPassword === null
          ? {}
          : { apiPasswordEncrypted: this.access.sealPassword(apiPassword) }),
      },
      include: withVenue,
    });
    await this.record(staff, "router_updated", row.id, row.name, origin, {
      passwordChanged: apiPassword !== null,
    });
    return routerRecord(row, staff.role);
  }

  /**
   * Deletes the router and frees its tunnel address. Safe because the platform admits a
   * tunnel peer by its public key, and the deleted router's peer is removed with it
   * (ADR-0006), so the physical router cannot use the address once it is reassigned.
   */
  async remove(staff: StaffPrincipal, id: string, origin: RequestOrigin): Promise<void> {
    const row = await this.row(staff, id);
    await this.db.router.delete({ where: { id } });
    await this.record(staff, "router_deleted", id, row.name, origin, {
      tunnelAddress: row.tunnelAddress,
    });
  }

  /** Pushes the venue's live vouchers to the router now. */
  async syncNow(staff: StaffPrincipal, id: string): Promise<RouterRecord> {
    await this.row(staff, id);
    await this.sync.syncRouter(id);
    return this.get(staff, id);
  }

  /**
   * The script an admin pastes into a fresh router. Safe to generate again: the API password
   * and the tunnel are created once and stored (sealed), so a second script configures the
   * same credentials and key as the first. A password given here replaces the stored one.
   */
  async bootstrapScript(
    staff: StaffPrincipal,
    id: string,
    input: z.infer<typeof bootstrapInput>,
    origin: RequestOrigin,
  ): Promise<BootstrapScriptResponse> {
    const router = await this.row(staff, id);
    if (router.apiUsername === null) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          apiUsername: "set an API username on the router first",
        }),
      );
    }
    const stored = this.access.credentials(router)?.password ?? null;
    const apiPassword = input.apiPassword || stored;
    const tunnel = await this.tunnelFor(router.id);
    const built = buildBootstrapScript({
      routerName: router.name,
      ipAddress: router.ipAddress,
      ...(input.lanPrefix === undefined ? {} : { lanPrefix: input.lanPrefix }),
      ...(input.gatewayIp ? { gatewayIp: input.gatewayIp } : {}),
      apiUsername: router.apiUsername,
      ...(apiPassword ? { apiPassword } : {}),
      ...(input.adminPassword ? { adminPassword: input.adminPassword } : {}),
      ...(input.ssid || router.ssid ? { ssid: input.ssid || router.ssid || "" } : {}),
      apiPort: this.config.mikrotik.apiPort,
      tunnel,
    });
    if (built.resolved.apiPassword !== stored) {
      await this.db.router.update({
        where: { id },
        data: { apiPasswordEncrypted: this.access.sealPassword(built.resolved.apiPassword) },
      });
    }
    await this.record(staff, "router_bootstrap_generated", id, router.name, origin, {
      tunnel: tunnel !== null,
      passwordChanged: built.resolved.apiPassword !== stored,
    });
    return { ...built, tunnel: tunnel !== null };
  }

  /** Tests credentials for a router not saved yet, and previews what setup would decide. */
  async testConnection(input: z.infer<typeof testConnectionInput>) {
    const creds = {
      host: input.ipAddress,
      port: this.config.mikrotik.apiPort,
      username: input.apiUsername,
      password: input.apiPassword,
      timeoutSeconds: this.config.mikrotik.connectTimeoutSeconds,
    };
    const logger = new RouterLogger("probe");
    let profile: RouterProfile;
    try {
      profile = await probeRouterMerged(creds, logger, null);
    } catch (err) {
      if (err instanceof RouterError) {
        // A failed test is a result the form shows, not an error.
        return { ok: false as const, kind: err.kind, error: err.message, hint: hintFor(err.kind) };
      }
      throw err;
    }
    const planInput = {
      ipAddress: input.ipAddress,
      hotspotInterface: input.hotspotInterface,
      networkRange: input.networkRange,
      hotspotGatewayIp: input.hotspotGatewayIp,
      hotspotName: input.hotspotName,
      ssid: input.ssid,
    };
    const { plan, planError } = planFor(planInput, profile);
    const { managementIp, managementError } = this.managementFor(input.ipAddress);
    const readiness = await probeReadiness(creds, logger, {
      profile,
      plan,
      planError,
      managementIp,
      managementError,
    }).catch(() => null);
    return {
      ok: true as const,
      board: {
        name: profile.boardName,
        identity: profile.identity,
        rosVersion: profile.rosVersion.raw,
        architecture: profile.architecture,
        uptime: profile.uptime,
      },
      readiness,
      wirelessStack: profile.wirelessStack,
      capabilities: profile.capabilities,
      compatibility: profile.compatibility,
      interfaces: profile.interfaces.map((i) => ({
        name: i.name,
        type: i.type,
        running: i.running,
        disabled: i.disabled,
        isRadio: isRadioInterfaceType(i.type),
        addresses: profile.addresses
          .filter((a) => a.interface === i.name && !a.disabled)
          .map((a) => a.address),
      })),
      plan,
      planError,
      management: managementIp,
      managementError,
    };
  }

  /** Reads the router (never writes to it), caches what it learned, and checks readiness. */
  async probe(staff: StaffPrincipal, id: string): Promise<ProbeResult> {
    const router = await this.row(staff, id);
    const creds = this.credentialsOf(router);
    const logger = new RouterLogger("probe");
    const profile = await this.reach(() => probeRouterMerged(creds, logger, router.capabilities));
    await this.db.router.update({
      where: { id },
      data: {
        rosVersion: profile.rosVersion.raw,
        architecture: profile.architecture,
        capabilities: toJsonValue(profile.capabilities),
        model: profile.boardName ?? router.model,
        identity: profile.identity ?? router.identity,
      },
    });
    const { plan, planError } = planFor(router, profile);
    const { managementIp, managementError } = this.managementFor(router.ipAddress);
    const readiness = await probeReadiness(creds, logger, {
      profile,
      plan,
      planError,
      managementIp,
      managementError,
    }).catch(() => null);
    return { runId: logger.runId, profile, plan, planError, readiness, log: logger.events() };
  }

  /**
   * Proves the router is serving. Changes no configuration; the write test creates and
   * removes one throwaway hotspot user unless skipped.
   */
  async verify(staff: StaffPrincipal, id: string, writeTest: boolean): Promise<VerifyReport> {
    const router = await this.row(staff, id);
    const creds = this.credentialsOf(router);
    const logger = new RouterLogger("probe");
    const profile = await this.reach(() => probeRouterMerged(creds, logger, router.capabilities));
    const { plan, planError } = planFor(router, profile);
    if (plan === null) {
      throw new BadRequestException(apiError("ROUTER_PLAN_INVALID", planError ?? "No plan."));
    }
    const report = await this.reach(() =>
      probeVerify(creds, logger, {
        dialect: dialectFor(profile),
        plan,
        endpoints: resolveBackendEndpoints(router.ipAddress, backendSettings(this.config)),
        includeWriteTest: writeTest,
      }),
    );
    if (report.discovered) {
      await this.store.recordCapabilities(id, { ...profile.capabilities, ...report.discovered });
    }
    return report;
  }

  /** Probe, readiness, dry run, provision, re-check and self-test, in one run. */
  async setup(staff: StaffPrincipal, id: string, force: boolean): Promise<SetupReport> {
    await this.row(staff, id);
    return setupRouter(id, this.store, { force });
  }

  async provision(staff: StaffPrincipal, id: string, dryRun: boolean): Promise<ProvisionReport> {
    await this.row(staff, id);
    return provisionRouter(id, this.store, { dryRun });
  }

  async latestProvision(staff: StaffPrincipal, id: string) {
    const router = await this.row(staff, id);
    return {
      report: router.lastProvisionReport,
      provisionedAt: router.provisionedAt?.toISOString() ?? null,
      capabilities: router.capabilities,
      rosVersion: router.rosVersion,
      architecture: router.architecture,
    };
  }

  /** The router, if the staff member's venues include it; otherwise not found. */
  private async row(staff: StaffPrincipal, id: string) {
    const row = await this.db.router.findFirst({
      where: { id, venue: venueScope(staff) },
      include: withVenue,
    });
    if (!row) throw routerNotFound();
    return row;
  }

  private credentialsOf(router: Parameters<RouterAccess["credentials"]>[0]) {
    const creds = this.access.credentials(router);
    if (!creds) {
      throw new BadRequestException(
        apiError("ROUTER_NO_CREDENTIALS", "Set the router's API username and password first."),
      );
    }
    return creds;
  }

  /** Runs work against the router; a router that cannot be reached or refuses us is a 502. */
  private async reach<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof RouterError) {
        throw new BadGatewayException(
          apiError(`ROUTER_${err.kind.toUpperCase()}`, err.message, null),
        );
      }
      throw err;
    }
  }

  private managementFor(routerHost: string) {
    try {
      const { ip } = resolveBackendEndpoints(routerHost, backendSettings(this.config)).management;
      return { managementIp: ip, managementError: null };
    } catch (err) {
      return {
        managementIp: null,
        managementError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async tunnelFor(routerId: string) {
    const settings = this.config.tunnel;
    if (settings === null || this.tunnels === null) return null;
    const tunnel = await this.tunnels.allocate(routerId);
    return {
      routerPrivateKey: tunnel.routerPrivateKey,
      routerAddress: `${tunnel.routerAddress}/${tunnel.prefix}`,
      serverPublicKey: settings.platformPublicKey,
      serverAddress: this.tunnels.platformAddress,
      endpointHost: settings.endpointHost,
      endpointPort: settings.endpointPort,
    };
  }

  /** A manager may not add routers, so only an admin reaches this; the venue must exist. */
  private async checkVenue(staff: StaffPrincipal, venueId: string): Promise<void> {
    const venue = await this.db.venue.findFirst({ where: { id: venueId, ...venueScope(staff) } });
    if (!venue) {
      throw new BadRequestException(
        apiError("VALIDATION_FAILED", "Check the highlighted fields.", {
          venueId: "no such venue",
        }),
      );
    }
  }

  private async record(
    staff: StaffPrincipal,
    action: string,
    entityId: string,
    entityName: string,
    origin: RequestOrigin,
    details: Record<string, string | number | boolean | null> = {},
  ): Promise<void> {
    await this.audit.record({
      staffId: staff.id,
      actorName: staff.name,
      action,
      entityType: "router",
      entityId,
      entityName,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      details,
    });
  }
}

function planFor(router: Parameters<typeof buildHotspotPlan>[0], profile: RouterProfile) {
  try {
    return { plan: buildHotspotPlan(router, profile), planError: null };
  } catch (err) {
    return { plan: null, planError: err instanceof Error ? err.message : String(err) };
  }
}

function hintFor(kind: RouterError["kind"]): string {
  switch (kind) {
    case "unreachable":
      return "Nothing answered the RouterOS API. Check the address, that this server can reach it, and that the API service is enabled: /ip service set api disabled=no";
    case "auth":
      return "The router refused these credentials. Confirm the user exists in a group with API access: /user add name=hashifi password=… group=full";
    default:
      return "The router answered, but the probe could not complete.";
  }
}

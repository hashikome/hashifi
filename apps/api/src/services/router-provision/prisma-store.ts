import { toJsonValue } from "../../database/json.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { RouterAccess } from "../router-credentials.js";
import type { RouterSync } from "../router-sync.js";
import type { BackendSettings } from "./context.js";
import type { RouterStore } from "./store.js";

/** The router store on PostgreSQL. */
export class PrismaRouterStore implements RouterStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: RouterAccess,
    private readonly sync: RouterSync,
    readonly backend: BackendSettings,
  ) {}

  load(routerId: string) {
    return this.db.router.findUnique({ where: { id: routerId } });
  }

  credentials(router: Parameters<RouterStore["credentials"]>[0]) {
    return this.access.credentials(router);
  }

  async markProvisioning(routerId: string): Promise<void> {
    await this.db.router.update({ where: { id: routerId }, data: { status: "provisioning" } });
  }

  async recordProvisionOutcome(
    router: Parameters<RouterStore["recordProvisionOutcome"]>[0],
    { ok, profile, report }: Parameters<RouterStore["recordProvisionOutcome"]>[1],
  ): Promise<void> {
    await this.db.router.update({
      where: { id: router.id },
      data: {
        status: ok ? "online" : "error",
        ...(ok ? { provisionedAt: new Date() } : {}),
        model: profile.boardName ?? router.model,
        identity: profile.identity ?? router.identity,
        rosVersion: profile.rosVersion.raw,
        architecture: profile.architecture,
        capabilities: toJsonValue(profile.capabilities),
        lastProvisionReport: toJsonValue(report),
      },
    });
  }

  async recordCapabilities(
    routerId: string,
    capabilities: Parameters<RouterStore["recordCapabilities"]>[1],
  ): Promise<void> {
    await this.db.router.update({
      where: { id: routerId },
      data: { capabilities: toJsonValue(capabilities) },
    });
  }

  resyncVouchers(routerId: string): Promise<void> {
    return this.sync.syncRouter(routerId);
  }
}

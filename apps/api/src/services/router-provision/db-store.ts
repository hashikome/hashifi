import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { routers } from "../../db/schema.js";
import { getRouterCredentials } from "../router-credentials.js";
import { syncNewRouter } from "../router-sync.js";
import type { RouterStore } from "./store.js";

/** The router store backed by the application database. */
export const dbRouterStore: RouterStore = {
  async load(routerId) {
    const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1);
    return router ?? null;
  },

  credentials(router) {
    return getRouterCredentials(router, "Provision");
  },

  async markProvisioning(routerId) {
    await db.update(routers).set({ status: "provisioning" }).where(eq(routers.id, routerId));
  },

  async recordProvisionOutcome(router, { ok, profile, report }) {
    await db
      .update(routers)
      .set({
        status: ok ? "online" : "error",
        ...(ok ? { provisionedAt: new Date() } : {}),
        model: profile.boardName ?? router.model,
        identity: profile.identity ?? router.identity,
        rosVersion: profile.rosVersion.raw,
        architecture: profile.architecture,
        capabilities: profile.capabilities,
        lastProvisionReport: report,
      })
      .where(eq(routers.id, router.id));
  },

  async recordCapabilities(routerId, capabilities) {
    await db.update(routers).set({ capabilities }).where(eq(routers.id, routerId));
  },

  async resyncVouchers(routerId) {
    await syncNewRouter(routerId);
  },
};

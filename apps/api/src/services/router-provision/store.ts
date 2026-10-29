import type { routers } from "../../db/schema.js";
import type { RouterCredentials } from "../mikrotik.js";
import type { RouterCapabilities, RouterProfile } from "./probe.js";

export type RouterRow = typeof routers.$inferSelect;

/** What a finished, non-dry provisioning run records about the router. */
export interface ProvisionOutcome {
  ok: boolean;
  profile: RouterProfile;
  /** The run's report without its command transcript. */
  report: unknown;
}

/**
 * Everything provisioning needs from persistence, so the provisioning code itself never
 * touches the database. The API supplies a database-backed store; the router sim supplies an
 * in-memory one for a virtual router.
 */
export interface RouterStore {
  load(routerId: string): Promise<RouterRow | null>;
  /** Credentials for the router's management target, or null when none are usable. */
  credentials(router: RouterRow): RouterCredentials | null;
  markProvisioning(routerId: string): Promise<void>;
  recordProvisionOutcome(router: RouterRow, outcome: ProvisionOutcome): Promise<void>;
  /** Persist capabilities the self-test measured, replacing the probe's version guess. */
  recordCapabilities(routerId: string, capabilities: RouterCapabilities): Promise<void>;
  /** Push the router's venue vouchers again, for when its capabilities changed. */
  resyncVouchers(routerId: string): Promise<void>;
}

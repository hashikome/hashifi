import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { routers, venues } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { RouterError } from "../services/mikrotik-errors.js";
import { getProvisioningBacklog } from "../services/reconcile-daemon.js";
import { DEFAULT_API_PORT, getRouterCredentials } from "../services/router-credentials.js";
import { RouterLogger } from "../services/router-log.js";
import { buildBootstrapScript } from "../services/router-provision/bootstrap.js";
import {
  buildHotspotPlan,
  isRadioInterfaceType,
  resolveBackendUrl,
} from "../services/router-provision/context.js";
import { dbRouterStore } from "../services/router-provision/db-store.js";
import { dialectFor } from "../services/router-provision/dialect.js";
import { provisionRouter } from "../services/router-provision/index.js";
import { probeRouterMerged, type RouterProfile } from "../services/router-provision/probe.js";
import { probeReadiness } from "../services/router-provision/readiness.js";
import { setupRouter } from "../services/router-provision/setup.js";
import { probeVerify } from "../services/router-provision/verify.js";
import { syncNewRouter } from "../services/router-sync.js";
import { logSystemEvent } from "../utils/audit.js";
import { encrypt } from "../utils/encrypt.js";
import { asyncRoute } from "../utils/route.js";

const router = Router();

router.use(requireAuth);

// Shared by the create/update schemas and by the "Test connection" preview, so a value the
// preview accepts is always a value that can actually be saved.
//
// Empty string means "auto-detect the radio" (see resolveHotspotInterface), so it is
// allowed through; anything present must look like a RouterOS interface name.
const hotspotInterfaceField = z
  .string()
  .max(80)
  .regex(/^[A-Za-z0-9_.-]*$/, "Interface names cannot contain spaces or slashes")
  .nullable()
  .optional();

const networkRangeField = z
  .string()
  .max(64)
  .refine(
    (v) => v === "" || /^\d{1,3}(\.\d{1,3}){3}\/(?:[89]|1\d|2\d|30)$/.test(v),
    "Must be a CIDR subnet between /8 and /30, e.g. 10.5.50.0/24",
  )
  .nullable()
  .optional();

// Empty string is stored as null upstream, meaning "leave whatever the radio is broadcasting".
const ssidField = z
  .string()
  .max(32)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "SSID cannot contain control characters")
  .nullable()
  .optional();

const routerSchema = z.object({
  venueId: z.string().uuid(),
  name: z.string().min(1).max(160),
  model: z.string().max(160).optional(),
  identity: z.string().max(160).optional(),
  ipAddress: z.string().min(1).max(45),
  hotspotGatewayIp: z.string().max(45).nullable().optional(),
  macAddress: z.string().max(32).optional(),
  apiUsername: z.string().max(120).optional(),
  apiPassword: z.string().optional(),
  enablePppoe: z.boolean().default(false),
  enableHotspot: z.boolean().default(true),
  pppoeSecret: z.string().optional(),
  hotspotName: z.string().max(160).nullable().optional(),
  hotspotInterface: hotspotInterfaceField,
  ssid: ssidField,
  networkRange: networkRangeField,
  provisioningCommand: z.string().optional(),
  status: z.enum(["online", "offline", "provisioning", "error"]).default("offline"),
});

const routerUpdateSchema = routerSchema.partial();

// Strip sensitive fields before sending to client
function safeRouter(r: typeof routers.$inferSelect, venueName?: string | null) {
  const { apiPasswordEncrypted, pppoeSecretEncrypted, ...safe } = r;
  return { ...safe, venueName: venueName ?? null };
}

// List all routers (with venue name)
router.get(
  "/",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const venueId = req.query.venueId as string | undefined;

    const query = db
      .select({
        router: routers,
        venueName: venues.name,
      })
      .from(routers)
      .leftJoin(venues, eq(routers.venueId, venues.id))
      .orderBy(desc(routers.createdAt));

    let where: Parameters<typeof query.where>[0];
    if (user.role === "manager") {
      where = venueId
        ? and(eq(routers.venueId, venueId), eq(venues.operatorId, user.id))
        : eq(venues.operatorId, user.id);
    } else if (venueId) {
      where = eq(routers.venueId, venueId);
    }

    const result = where ? await query.where(where) : await query;

    res.json({
      routers: result.map((r) => safeRouter(r.router, r.venueName)),
    });
  }),
);

// How many customers are currently stranded: vouchers the router never confirmed, and
// payments captured without provisioning. Declared before "/:id" so it isn't swallowed
// by the param route.
router.get(
  "/provisioning-backlog",
  asyncRoute(async (_req, res) => {
    res.json(await getProvisioningBacklog());
  }),
);

// Get single router
router.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const user = (req as any).user;
    const condition =
      user.role === "manager"
        ? and(eq(routers.id, req.params.id as string), eq(venues.operatorId, user.id))
        : eq(routers.id, req.params.id as string);

    const result = await db
      .select({ router: routers, venueName: venues.name })
      .from(routers)
      .leftJoin(venues, eq(routers.venueId, venues.id))
      .where(condition)
      .limit(1);

    if (!result.length) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    res.json({ router: safeRouter(result[0].router, result[0].venueName) });
  }),
);

// Create router
router.post(
  "/",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = routerSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    // Verify venue exists
    const [venue] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, parsed.data.venueId))
      .limit(1);

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    const { apiPassword, pppoeSecret, ...rest } = parsed.data;

    // Pre-generate the ID so we can hand it to the background sync
    const newRouterId = randomUUID();

    await db.insert(routers).values({
      id: newRouterId,
      ...rest,
      apiPasswordEncrypted: apiPassword ? encrypt(apiPassword) : null,
      pppoeSecretEncrypted: pppoeSecret ? encrypt(pppoeSecret) : null,
    });

    res.status(201).json({ ok: true, message: "Router created successfully" });

    // Fire-and-forget is acceptable here (nobody is waiting to get online), but the
    // failure must still be recorded rather than only hitting stdout.
    syncNewRouter(newRouterId).catch(async (err) => {
      console.error("[RouterSync] New router sync failed:", err);
      await logSystemEvent({
        action: "router.initial_sync_failed",
        entityType: "router",
        entityId: newRouterId,
        entityName: rest.name,
        details: { error: (err as Error).message },
      });
    });
  }),
);

// Force-sync a router: test connection + push all venue vouchers
router.post(
  "/:id/sync",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const [existing] = await db
      .select({ id: routers.id })
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    // Run sync and respond with result
    try {
      await syncNewRouter(req.params.id as string);
      res.json({ ok: true, message: "Sync completed successfully" });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Sync failed" });
    }
  }),
);

/**
 * Exported for `bootstrap.test.ts`. `buildBootstrapScript` trusts its input and only *warns* about
 * things it can still generate a script for (a gateway outside the subnet, say); this schema is the
 * layer that refuses input outright, so it is where "bad input is rejected" has to be proved.
 */
export const bootstrapSchema = z.object({
  routerName: z.string().min(1).max(160),
  ipAddress: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/, "Must be an IPv4 address"),
  lanPrefix: z.coerce.number().int().min(8).max(30).optional(),
  gatewayIp: z
    .string()
    .regex(/^(\d{1,3}(\.\d{1,3}){3})?$/, "Must be an IPv4 address")
    .optional(),
  apiUsername: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/, "Usernames cannot contain spaces or quotes"),
  // Control characters would break the pasted script; the quoting handles everything else.
  apiPassword: z
    .string()
    .max(200)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Password cannot contain control characters")
    .optional(),
  adminPassword: z
    .string()
    .max(200)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Password cannot contain control characters")
    .optional(),
  ssid: z
    .string()
    .max(32)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "SSID cannot contain control characters")
    .optional(),
});

/**
 * Generate the manual bootstrap script for a router that does not exist yet.
 *
 * Deliberately needs no router row and touches nothing: it renders text. This is the "paste
 * one block, make no hardware decision" half of onboarding — see `bootstrap.ts` for why the
 * script detects the wireless stack on the router rather than here.
 */
router.post(
  "/bootstrap-script",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = bootstrapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    // Never logged: the response carries an API password in clear text by necessity — it has
    // to be typed into the router — so it must not also land in the server's stdout.
    res.json(buildBootstrapScript(parsed.data));
  }),
);

const testConnectionSchema = z.object({
  /** Supplied by the edit form so a blank password field can mean "keep the stored one". */
  routerId: z.string().uuid().optional(),
  ipAddress: z.string().max(45).optional(),
  apiUsername: z.string().max(120).optional(),
  apiPassword: z.string().optional(),
  // The Hotspot Network fields, so the preview matches what provisioning would decide.
  hotspotInterface: hotspotInterfaceField,
  networkRange: networkRangeField,
  hotspotGatewayIp: z.string().max(45).nullable().optional(),
  hotspotName: z.string().max(160).nullable().optional(),
  ssid: ssidField,
});

/**
 * Test credentials against a router that has not been saved yet, and preview the plan.
 *
 * This is the create/edit form's "Test connection" button. It exists because the only way
 * to find out whether the IP and password were right used to be: save the record, leave the
 * form, open the provision dialog, press Probe. Wrong password meant doing that loop again.
 *
 * Read-only in both directions — it never writes to the router, and unlike `/:id/probe` it
 * never caches onto the row, because the values being tested are not saved yet.
 */
router.post(
  "/test-connection",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = testConnectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const input = parsed.data;

    // Fall back to the stored row for anything the form left blank. On the edit page the
    // password field is intentionally empty when the admin isn't changing it.
    let stored: typeof routers.$inferSelect | undefined;
    if (input.routerId) {
      [stored] = await db.select().from(routers).where(eq(routers.id, input.routerId)).limit(1);
    }

    const host = input.ipAddress?.trim() || stored?.ipAddress || "";
    const username = input.apiUsername?.trim() || stored?.apiUsername || "";
    const password =
      input.apiPassword || (stored ? getRouterCredentials(stored, "TestConnection")?.password : "");

    if (!host) {
      res.status(400).json({ error: "Enter the router's IP address first." });
      return;
    }
    if (!username || !password) {
      res.status(400).json({
        error: stored
          ? "Enter an API username and password — none are stored for this router yet."
          : "Enter an API username and password to test the connection.",
      });
      return;
    }

    const logger = new RouterLogger("probe");

    // Merged when a row exists, so the preview shows the capabilities a real Set up would use
    // rather than the version guess. `stored` is undefined for a router being added, and
    // mergeCapabilities takes the probe as-is in that case.
    let profile: RouterProfile;
    try {
      profile = await probeRouterMerged(
        { host, port: DEFAULT_API_PORT, username, password },
        logger,
        stored?.capabilities,
      );
    } catch (err) {
      if (err instanceof RouterError) {
        // A failed test is a successful request — the form renders this inline.
        res.json({ ok: false, kind: err.kind, error: err.message, hint: hintFor(err.kind, host) });
        return;
      }
      throw err;
    }

    // What would provisioning choose? Running the real planner means the preview cannot
    // drift from the actual decision, including its refusals.
    const planInput = {
      ipAddress: host,
      hotspotInterface: input.hotspotInterface ?? null,
      networkRange: input.networkRange ?? null,
      hotspotGatewayIp: input.hotspotGatewayIp ?? null,
      hotspotName: input.hotspotName ?? null,
      ssid: input.ssid ?? stored?.ssid ?? null,
    };

    let plan: ReturnType<typeof buildHotspotPlan> | null = null;
    let planError: string | null = null;
    try {
      plan = buildHotspotPlan(planInput, profile);
    } catch (err) {
      planError = err instanceof Error ? err.message : String(err);
    }

    // Provisioning aborts if it cannot find its own address on the router's subnet, so
    // report that here too rather than letting it surface three clicks later.
    let backend: { url: string; ip: string } | null = null;
    let backendError: string | null = null;
    try {
      backend = resolveBackendUrl(host);
    } catch (err) {
      backendError = err instanceof Error ? err.message : String(err);
    }

    // Advisory: a readiness failure must not turn a successful connection test into an error.
    let readiness: Awaited<ReturnType<typeof probeReadiness>> | null = null;
    try {
      readiness = await probeReadiness(
        { host, port: DEFAULT_API_PORT, username, password },
        logger,
        {
          profile,
          plan,
          planError,
          backendIp: backend?.ip ?? null,
          backendError,
        },
      );
    } catch (err) {
      logger.warn(`Readiness checks could not run: ${err instanceof Error ? err.message : err}`);
    }

    res.json({
      ok: true,
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
      backend,
      backendError,
    });
  }),
);

function hintFor(kind: RouterError["kind"], host: string): string {
  switch (kind) {
    case "unreachable":
      return (
        `Nothing answered the RouterOS API on ${host}:8728. Check the IP, that the backend ` +
        `is on the same network, and that the API service is enabled — ` +
        `/ip service set api disabled=no port=8728`
      );
    case "auth":
      return (
        `The router rejected these credentials. Confirm the user exists and is in a group ` +
        `with API access — /user add name=billing-api password=… group=full`
      );
    default:
      return "The router answered but the probe could not complete. See the message above.";
  }
}

// Probe a router's capabilities — read-only, never writes to the device.
// Answers "can this board run our hotspot at all, and what does it support?"
router.post(
  "/:id/probe",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const [existing] = await db
      .select()
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    const creds = getRouterCredentials(existing, "Probe");
    if (!creds) {
      res.status(400).json({
        error: "Router has no API credentials configured. Set an API username and password.",
      });
      return;
    }

    const logger = new RouterLogger("probe");

    try {
      // A capability the self-test measured as unsupported must survive re-probing.
      const profile = await probeRouterMerged(creds, logger, existing.capabilities);

      // Cache what we learned so sync/daemons can branch on it without re-probing.
      await db
        .update(routers)
        .set({
          rosVersion: profile.rosVersion.raw,
          architecture: profile.architecture,
          capabilities: profile.capabilities,
          model: profile.boardName ?? existing.model,
          identity: profile.identity ?? existing.identity,
        })
        .where(eq(routers.id, existing.id));

      // The same plan preview and readiness checklist the create/edit form shows, so the
      // provision dialog can name the site problems (no internet, backend unreachable,
      // FastTrack on, hand-made config) instead of only "Compatible / Incompatible".
      let plan: ReturnType<typeof buildHotspotPlan> | null = null;
      let planError: string | null = null;
      try {
        plan = buildHotspotPlan(existing, profile);
      } catch (planErr) {
        planError = planErr instanceof Error ? planErr.message : String(planErr);
      }

      let backendIp: string | null = null;
      let backendError: string | null = null;
      try {
        backendIp = resolveBackendUrl(existing.ipAddress).ip;
      } catch (backendErr) {
        backendError = backendErr instanceof Error ? backendErr.message : String(backendErr);
      }

      let readiness: Awaited<ReturnType<typeof probeReadiness>> | null = null;
      try {
        readiness = await probeReadiness(creds, logger, {
          profile,
          plan,
          planError,
          backendIp,
          backendError,
        });
      } catch (readinessErr) {
        logger.warn(
          `Readiness checks could not run: ${
            readinessErr instanceof Error ? readinessErr.message : readinessErr
          }`,
        );
      }

      res.json({
        ok: true,
        runId: logger.runId,
        profile,
        plan,
        planError,
        readiness,
        log: logger.events(),
      });
    } catch (err) {
      if (err instanceof RouterError) {
        // Unreachable / bad credentials — a real failure, not an incompatible board.
        res.status(502).json({
          ok: false,
          runId: logger.runId,
          error: err.message,
          detail: err.toJSON(),
          log: logger.events(),
        });
        return;
      }
      throw err;
    }
  }),
);

/**
 * Prove a router is actually serving — the machine-checkable half of ROUTER_ONBOARDING.md
 * Step 5. Changes no configuration; the voucher round-trip creates and removes one throwaway
 * hotspot user, which `?skipWriteTest=1` suppresses.
 */
router.post(
  "/:id/verify",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const skipWriteTest = req.query.skipWriteTest === "1" || req.query.skipWriteTest === "true";

    const [existing] = await db
      .select()
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    const creds = getRouterCredentials(existing, "Verify");
    if (!creds) {
      res.status(400).json({ error: "Router has no API credentials configured." });
      return;
    }

    const logger = new RouterLogger("probe");

    try {
      const profile = await probeRouterMerged(creds, logger, existing.capabilities);
      const plan = buildHotspotPlan(existing, profile);
      const backend = resolveBackendUrl(existing.ipAddress);

      const report = await probeVerify(creds, logger, {
        dialect: dialectFor(profile),
        plan,
        backendUrl: backend.url,
        backendIp: backend.ip,
        includeWriteTest: !skipWriteTest,
      });

      // The write test may have proved the version-based capability guess wrong. Persisting it
      // stops every future voucher on this router paying for a rejected attempt first.
      if (report.discovered) {
        const corrected = { ...profile.capabilities, ...report.discovered };
        await db
          .update(routers)
          .set({ capabilities: corrected })
          .where(eq(routers.id, existing.id));
        logger.warn(
          `Corrected cached capabilities from the self-test: ${JSON.stringify(report.discovered)}`,
        );
      }

      res.json({ ok: report.ok, runId: logger.runId, verify: report, log: logger.events() });
    } catch (err) {
      if (err instanceof RouterError) {
        res.status(502).json({ ok: false, error: err.message, log: logger.events() });
        return;
      }
      // A plan or backend-address problem is a config error, not a router failure.
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        log: logger.events(),
      });
    }
  }),
);

/**
 * Set up a router end to end: probe → readiness gate → dry run → provision → verify.
 *
 * The one button that replaces knowing the procedure. `?force=1` proceeds past failing
 * readiness checks, for the operator who has read them and accepted them.
 */
router.post(
  "/:id/setup",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const force = req.query.force === "1" || req.query.force === "true";

    const [existing] = await db
      .select({ id: routers.id })
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    // A run that stops at a blocking reason is a useful result, not a 5xx.
    const report = await setupRouter(req.params.id as string, dbRouterStore, { force });
    res.json(report);
  }),
);

// Provision a router — runs the full configuration sequence.
// ?dryRun=1 reports what would change without writing anything.
router.post(
  "/:id/provision",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";

    const [existing] = await db
      .select({ id: routers.id })
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    const report = await provisionRouter(req.params.id as string, dbRouterStore, { dryRun });
    // A run that aborts on an incompatible board is a valid, useful result — not a 5xx.
    res.json(report);
  }),
);

// Last stored provisioning report
router.get(
  "/:id/provision/latest",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const [existing] = await db
      .select({
        report: routers.lastProvisionReport,
        provisionedAt: routers.provisionedAt,
        capabilities: routers.capabilities,
        rosVersion: routers.rosVersion,
        architecture: routers.architecture,
      })
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    res.json(existing);
  }),
);

// Update router
router.patch(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = routerUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const [existing] = await db
      .select({ id: routers.id })
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    const { apiPassword, pppoeSecret, ...rest } = parsed.data;
    const updateData: Record<string, unknown> = { ...rest };

    if (apiPassword !== undefined) updateData.apiPasswordEncrypted = encrypt(apiPassword);
    if (pppoeSecret !== undefined) updateData.pppoeSecretEncrypted = encrypt(pppoeSecret);

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    await db
      .update(routers)
      .set(updateData)
      .where(eq(routers.id, req.params.id as string));

    res.json({ ok: true, message: "Router updated successfully" });
  }),
);

// Delete router
router.delete(
  "/:id",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const [existing] = await db
      .select({ id: routers.id })
      .from(routers)
      .where(eq(routers.id, req.params.id as string))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Router not found" });
      return;
    }

    await db.delete(routers).where(eq(routers.id, req.params.id as string));

    res.json({ ok: true, message: "Router deleted successfully" });
  }),
);

export { router as routersRouter };

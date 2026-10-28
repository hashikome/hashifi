/**
 * "Set up router" — the whole procedure as one call.
 *
 * Onboarding used to ask a human to press four buttons in order and to know what each result
 * meant: Probe, read the compatibility verdict, Dry run, Provision, then Provision *again* to
 * prove the run was idempotent. That is a state machine being executed by a person, and the
 * failure mode is skipping a step — most damagingly pressing Provision on a router that cannot
 * reach the backend, because `portal-files` is critical and runs last, so fourteen writes land
 * before anything complains. This is that sequence as code; ROUTER_ONBOARDING.md Step 4 is now
 * just "press Set up router".
 *
 * This runs the same sequence and stops at the first thing that would make the result wrong,
 * reporting it with the fix attached. Every phase shares one `RouterLogger`, so the admin UI
 * sees a single continuous command transcript over /ws/live rather than four disconnected ones.
 *
 * Two deliberate differences from the manual procedure:
 *
 *  - **Readiness is a gate, not advice.** A router with no route to the backend is not
 *    provisioned at all; `force` exists for the operator who has read the reason and wants to
 *    proceed anyway.
 *  - **Idempotency is verified with a dry run, not a second provision.** It proves exactly the
 *    same thing — anything still reported as "would apply" was not idempotent — while writing
 *    nothing.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { routers } from "../../db/schema.js";
import { RouterError } from "../mikrotik-errors.js";
import { getRouterCredentials } from "../router-credentials.js";
import { type RouterLogEvent, RouterLogger } from "../router-log.js";
import { syncNewRouter } from "../router-sync.js";
import { buildHotspotPlan, type HotspotPlan, resolveBackendUrl } from "./context.js";
import { dialectFor } from "./dialect.js";
import { type ProvisionReport, provisionRouter } from "./index.js";
import { probeRouterMerged, type RouterProfile } from "./probe.js";
import { probeReadiness, type ReadinessReport } from "./readiness.js";
import { probeVerify, type VerifyReport } from "./verify.js";

export type SetupPhaseId = "probe" | "readiness" | "dry-run" | "provision" | "verify" | "self-test";
export type SetupPhaseStatus = "pass" | "warn" | "fail" | "skipped";

export interface SetupPhase {
  id: SetupPhaseId;
  title: string;
  status: SetupPhaseStatus;
  detail: string;
  durationMs: number;
}

export interface SetupBlocker {
  reason: string;
  fix?: string;
}

export interface SetupReport {
  runId: string;
  routerId: string;
  host: string;
  /**
   * True only when the router was provisioned, proved idempotent, AND passed the self-test.
   * Configuration that reads back correctly but cannot serve a customer is not success.
   */
  ok: boolean;
  /** The phase that halted the run, or null if it ran to completion. */
  stoppedAt: SetupPhaseId | null;
  forced: boolean;
  startedAt: string;
  finishedAt: string;
  phases: SetupPhase[];
  /** What to fix, in the order to fix it. Empty on success. */
  blockers: SetupBlocker[];
  profile: RouterProfile | null;
  plan: HotspotPlan | null;
  readiness: ReadinessReport | null;
  dryRun: ProvisionReport | null;
  provision: ProvisionReport | null;
  verify: ProvisionReport | null;
  /** Proof the hotspot is actually serving, not just that the config reads back. */
  selfTest: VerifyReport | null;
  log: readonly RouterLogEvent[];
}

export interface SetupOptions {
  /** Proceed past failing readiness checks. The operator has read them and accepted them. */
  force?: boolean;
  logger?: RouterLogger;
}

const PHASE_TITLES: Record<SetupPhaseId, string> = {
  probe: "Identify the board and confirm it can run a hotspot",
  readiness: "Check the site is ready",
  "dry-run": "Preview every change",
  provision: "Apply the configuration",
  verify: "Prove the run is repeatable",
  "self-test": "Confirm the hotspot is actually serving",
};

export async function setupRouter(routerId: string, opts: SetupOptions = {}): Promise<SetupReport> {
  const force = opts.force ?? false;
  const logger = opts.logger ?? new RouterLogger("provision");
  const startedAt = new Date().toISOString();

  const phases: SetupPhase[] = [];
  const blockers: SetupBlocker[] = [];
  let stoppedAt: SetupPhaseId | null = null;

  let profile: RouterProfile | null = null;
  let plan: HotspotPlan | null = null;
  let readiness: ReadinessReport | null = null;
  let dryRun: ProvisionReport | null = null;
  let provision: ProvisionReport | null = null;
  let verify: ProvisionReport | null = null;
  let selfTest: VerifyReport | null = null;

  const [router] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1);
  if (!router) throw new Error(`Router ${routerId} not found`);

  const finish = (): SetupReport => ({
    runId: logger.runId,
    routerId,
    host: router.ipAddress,
    ok: stoppedAt === null && verify !== null && verify.ok && selfTest?.ok === true,
    stoppedAt,
    forced: force,
    startedAt,
    finishedAt: new Date().toISOString(),
    phases,
    blockers,
    profile,
    plan,
    readiness,
    dryRun,
    provision,
    verify,
    selfTest,
    log: logger.events(),
  });

  /** Record a phase and, when it fails, halt the run. */
  const record = (
    id: SetupPhaseId,
    status: SetupPhaseStatus,
    detail: string,
    startedMs: number,
  ): boolean => {
    phases.push({
      id,
      title: PHASE_TITLES[id],
      status,
      detail,
      durationMs: Date.now() - startedMs,
    });
    if (status === "fail") {
      stoppedAt = id;
      logger.error(`Stopping: ${detail}`);
      return false;
    }
    return true;
  };

  const skipRest = (from: SetupPhaseId) => {
    const order: SetupPhaseId[] = [
      "probe",
      "readiness",
      "dry-run",
      "provision",
      "verify",
      "self-test",
    ];
    for (const id of order.slice(order.indexOf(from) + 1)) {
      phases.push({
        id,
        title: PHASE_TITLES[id],
        status: "skipped",
        detail: "Not attempted — an earlier phase stopped the run.",
        durationMs: 0,
      });
    }
  };

  const creds = getRouterCredentials(router, "Setup");
  if (!creds) {
    blockers.push({
      reason: "This router has no API credentials stored.",
      fix: "Set an API username and password on the router, then run Set up again.",
    });
    record("probe", "fail", "No API credentials stored.", Date.now());
    skipRest("probe");
    return finish();
  }

  logger.summary(`Setting up "${router.name}" (${router.ipAddress})${force ? " — FORCED" : ""}`);

  // ── 1. Probe ──────────────────────────────────────────────────────────────
  {
    const t = Date.now();
    logger.info("▶ 1/6 · Identifying the board");
    try {
      // Merged, never raw: this profile is what phase 6's dialect is built from, and taking the
      // raw probe here meant one run held two different views of the same board. See
      // `probeRouterMerged`.
      profile = await probeRouterMerged(creds, logger, router.capabilities);
    } catch (err) {
      const message = err instanceof RouterError ? err.message : String(err);
      blockers.push({
        reason: message,
        fix:
          err instanceof RouterError && err.kind === "auth"
            ? "Check the API username and password. /user add name=billing-api password=… group=full"
            : `Check the IP address and that the API service is on: /ip service set api disabled=no port=8728`,
      });
      record("probe", "fail", message, t);
      skipRest("probe");
      return finish();
    }

    if (!profile.compatibility.ok) {
      for (const reason of profile.compatibility.reasons) blockers.push({ reason });
      record("probe", "fail", profile.compatibility.reasons[0] ?? "Board cannot run a hotspot.", t);
      skipRest("probe");
      return finish();
    }

    record(
      "probe",
      "pass",
      `${profile.boardName ?? "Unknown board"} · RouterOS ${profile.rosVersion.raw} · ${
        profile.architecture ?? "?"
      }`,
      t,
    );
  }

  // ── 2. Readiness ──────────────────────────────────────────────────────────
  {
    const t = Date.now();
    logger.info("▶ 2/6 · Checking the site is ready");

    let planError: string | null = null;
    try {
      plan = buildHotspotPlan(router, profile);
    } catch (err) {
      planError = err instanceof Error ? err.message : String(err);
    }

    let backendIp: string | null = null;
    let backendError: string | null = null;
    try {
      backendIp = resolveBackendUrl(router.ipAddress).ip;
    } catch (err) {
      backendError = err instanceof Error ? err.message : String(err);
    }

    try {
      readiness = await probeReadiness(creds, logger, {
        profile,
        plan,
        planError,
        backendIp,
        backendError,
      });
    } catch (err) {
      // Readiness is diagnostic; losing it must not stop a run that would otherwise work.
      logger.warn(
        `Readiness checks could not run: ${err instanceof Error ? err.message : String(err)}`,
      );
      record("readiness", "warn", "Checks could not be completed — continuing.", t);
    }

    if (readiness) {
      const failed = readiness.checks.filter((c) => c.status === "fail");
      const warned = readiness.checks.filter((c) => c.status === "warn");

      if (failed.length > 0 && !force) {
        for (const c of failed) blockers.push({ reason: `${c.title}: ${c.detail}`, fix: c.fix });
        record(
          "readiness",
          "fail",
          `${failed.length} problem${failed.length === 1 ? "" : "s"} would stop this working. ` +
            `Nothing was written to the router.`,
          t,
        );
        skipRest("readiness");
        return finish();
      }

      if (failed.length > 0) {
        logger.warn(
          `Continuing past ${failed.length} failed readiness check(s) because force was set`,
        );
        record("readiness", "warn", `${failed.length} problem(s) overridden by force.`, t);
      } else {
        record(
          "readiness",
          warned.length > 0 ? "warn" : "pass",
          warned.length > 0
            ? `Ready, with ${warned.length} thing${warned.length === 1 ? "" : "s"} to know.`
            : "Everything the hotspot depends on is in place.",
          t,
        );
      }
    }
  }

  // ── 3. Dry run ────────────────────────────────────────────────────────────
  {
    const t = Date.now();
    logger.info("▶ 3/6 · Previewing changes");
    dryRun = await provisionRouter(routerId, { dryRun: true, logger });

    if (dryRun.aborted || dryRun.summary.failed > 0) {
      for (const reason of dryRun.blockingReasons) blockers.push({ reason });
      for (const step of dryRun.steps.filter((s) => s.state === "failed")) {
        blockers.push({ reason: `${step.title}: ${step.message ?? "failed"}` });
      }
      record(
        "dry-run",
        "fail",
        dryRun.aborted
          ? "Aborted before writing anything."
          : `${dryRun.summary.failed} step(s) failed while only reading. Nothing was written.`,
        t,
      );
      skipRest("dry-run");
      return finish();
    }

    record(
      "dry-run",
      "pass",
      `${dryRun.summary.wouldApply} change(s) to make, ${dryRun.summary.satisfied} already correct.`,
      t,
    );
  }

  // ── 4. Provision ──────────────────────────────────────────────────────────
  {
    const t = Date.now();
    logger.info("▶ 4/6 · Applying the configuration");
    provision = await provisionRouter(routerId, { dryRun: false, logger });

    if (!provision.ok) {
      for (const reason of provision.blockingReasons) blockers.push({ reason });
      for (const step of provision.steps.filter((s) => s.state === "failed")) {
        blockers.push({
          reason: `${step.title}: ${step.message ?? "failed"}`,
          fix: step.critical
            ? "This step is critical, so later steps were skipped. Fix it and run Set up again."
            : undefined,
        });
      }
      record(
        "provision",
        "fail",
        `${provision.summary.failed} step(s) failed, ${provision.summary.applied} applied.`,
        t,
      );
      skipRest("provision");
      return finish();
    }

    record(
      "provision",
      "pass",
      `${provision.summary.applied} change(s) applied, ${provision.summary.satisfied} already correct.`,
      t,
    );
  }

  // ── 5. Verify idempotency ─────────────────────────────────────────────────
  {
    const t = Date.now();
    logger.info("▶ 5/6 · Confirming the configuration reads back correctly");
    verify = await provisionRouter(routerId, { dryRun: true, logger });

    const outstanding = verify.summary.wouldApply;
    if (outstanding > 0 || verify.summary.failed > 0) {
      for (const step of verify.steps.filter(
        (s) => s.state === "would-apply" || s.state === "failed",
      )) {
        blockers.push({
          reason: `${step.title} did not stay applied.`,
          fix:
            "The write was accepted but reading it back disagrees. Usually the board silently " +
            "rejected a value — check the command transcript for this step.",
        });
      }
      record(
        "verify",
        "fail",
        `${outstanding} step(s) still report changes after provisioning, so the configuration ` +
          `did not stick.`,
        t,
      );
      return finish();
    }

    record("verify", "pass", "Re-checked every step: all already correct.", t);
  }

  // ── 6. Self-test ──────────────────────────────────────────────────────────
  // Phases 1-5 prove the configuration is what we asked for. This asks the different and more
  // useful question: would a paying customer actually get online?
  {
    const t = Date.now();
    logger.info("▶ 6/6 · Confirming the hotspot is actually serving");

    if (!plan) {
      record("self-test", "skipped", "No hotspot plan to test against.", t);
    } else {
      try {
        const backend = resolveBackendUrl(router.ipAddress);
        selfTest = await probeVerify(creds, logger, {
          dialect: dialectFor(profile),
          plan,
          backendUrl: backend.url,
          backendIp: backend.ip,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Self-test could not run: ${message}`);
        record("self-test", "warn", `Could not be completed: ${message}`, t);
      }

      // The self-test can prove the probe's version-based capability guess wrong. Persist it, or
      // every voucher sold on this router pays for a rejected attempt first.
      if (selfTest?.discovered) {
        await db
          .update(routers)
          .set({ capabilities: { ...profile.capabilities, ...selfTest.discovered } })
          .where(eq(routers.id, routerId));
        logger.warn(
          `Corrected cached capabilities from the self-test: ${JSON.stringify(selfTest.discovered)}`,
        );

        /*
         * Re-sync the venue's vouchers now that the board's real capabilities are known.
         *
         * Saving the router pushes its venue's vouchers immediately — before anything has ever
         * probed the board. `needsProfileLimits(null)` is deliberately false there (creating
         * profiles a board does not need is permanent clutter), so those vouchers go up with no
         * `=profile=` and no cap. Set up then measures `userRateLimit: false` a minute later, and
         * nothing re-pushes: on a freshly onboarded router every voucher sold so far stays
         * uncapped until some unrelated push happens to repair it.
         *
         * Measured on a clean board: 10 vouchers, all on `default`, no `wbs-pkg-*` profile in
         * sight, on a run that reported ok: true.
         *
         * `syncNewRouter` is exactly the repair — it creates the per-package profiles and moves
         * existing users onto them — and it is idempotent, so running it here costs one pass over
         * vouchers that are already correct. Only when the capabilities actually changed, since
         * that is the only case where what was pushed earlier could be wrong.
         */
        try {
          await syncNewRouter(routerId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(
            `Vouchers could not be re-synced after the capability correction: ${message}. ` +
              `They may be missing their speed cap — push again from the venue's vouchers.`,
          );
        }
      }

      if (selfTest) {
        const failed = selfTest.checks.filter((c) => c.status === "fail");
        if (failed.length > 0) {
          for (const c of failed) blockers.push({ reason: `${c.title}: ${c.detail}`, fix: c.fix });
          record(
            "self-test",
            "fail",
            `Configured, but ${failed.length} check${failed.length === 1 ? "" : "s"} show the ` +
              `hotspot would not serve customers.`,
            t,
          );
          return finish();
        }
        const warned = selfTest.checks.filter((c) => c.status === "warn").length;
        record(
          "self-test",
          warned > 0 ? "warn" : "pass",
          warned > 0
            ? `Serving, with ${warned} thing${warned === 1 ? "" : "s"} to know.`
            : "Hotspot server, DHCP, radio, portal pages and voucher creation all confirmed.",
          t,
        );
      }
    }
  }

  logger.summary(
    `Set up "${router.name}" successfully — ${provision?.summary.applied ?? 0} change(s) applied ` +
      `and verified.`,
  );

  return finish();
}

/**
 * Provisioning orchestrator.
 *
 * Runs the step registry against a router, in order, with a hard compatibility gate up
 * front: an incompatible board is reported and left completely untouched rather than
 * half-configured.
 *
 * Verification is not a separate phase — after `apply` the step's own `check` runs again.
 * If it still reports "not satisfied", the step failed regardless of what RouterOS said.
 */

import { closeConnection, connectToRouter, type MikroTikConn } from "../mikrotik.js";
import { RouterError } from "../mikrotik-errors.js";
import { type RouterLogEvent, RouterLogger } from "../router-log.js";
import { buildContext, type ProvisionContext } from "./context.js";
import { dialectFor } from "./dialect.js";
import { probeRouterMerged, type RouterProfile } from "./probe.js";
import { RosClient } from "./ros-client.js";
import { PROVISION_STEPS, type ProvisionStep } from "./steps.js";
import type { RouterStore } from "./store.js";

export type StepState = "satisfied" | "applied" | "would-apply" | "skipped" | "failed";

export interface StepResult {
  id: string;
  title: string;
  state: StepState;
  critical: boolean;
  durationMs: number;
  message?: string;
  error?: ReturnType<RouterError["toJSON"]>;
}

export interface ProvisionReport {
  runId: string;
  routerId: string;
  host: string;
  dryRun: boolean;
  ok: boolean;
  aborted: boolean;
  startedAt: string;
  finishedAt: string;
  profile: RouterProfile | null;
  steps: StepResult[];
  summary: {
    total: number;
    satisfied: number;
    applied: number;
    wouldApply: number;
    skipped: number;
    failed: number;
  };
  blockingReasons: string[];
  log: readonly RouterLogEvent[];
}

export interface ProvisionOptions {
  dryRun?: boolean;
  logger?: RouterLogger;
}

function summarize(steps: StepResult[]): ProvisionReport["summary"] {
  const count = (state: StepState) => steps.filter((s) => s.state === state).length;
  return {
    total: steps.length,
    satisfied: count("satisfied"),
    applied: count("applied"),
    wouldApply: count("would-apply"),
    skipped: count("skipped"),
    failed: count("failed"),
  };
}

async function runStep(
  step: ProvisionStep,
  ros: RosClient,
  ctx: ProvisionContext,
  logger: RouterLogger,
): Promise<StepResult> {
  const started = Date.now();
  const base = { id: step.id, title: step.title, critical: step.critical };

  if (!step.appliesTo(ctx)) {
    logger.info(`— ${step.title} · not applicable to this board`);
    return { ...base, state: "skipped", durationMs: Date.now() - started };
  }

  logger.info(`▶ ${step.title}`);

  try {
    if (await step.check({ ros, ctx })) {
      logger.info(`✓ ${step.title} · already correct`);
      return { ...base, state: "satisfied", durationMs: Date.now() - started };
    }

    if (ctx.dryRun) {
      logger.info(`… ${step.title} · WOULD APPLY`);
      return { ...base, state: "would-apply", durationMs: Date.now() - started };
    }

    await step.apply({ ros, ctx });

    // Verification: the step must be able to see its own work.
    if (!(await step.check({ ros, ctx }))) {
      logger.warn(`✗ ${step.title} · applied but verification failed`);
      return {
        ...base,
        state: "failed",
        durationMs: Date.now() - started,
        message: "Command succeeded but reading the configuration back did not confirm it.",
      };
    }

    logger.info(`✓ ${step.title} · applied`);
    return { ...base, state: "applied", durationMs: Date.now() - started };
  } catch (err) {
    const typed = err instanceof RouterError ? err : null;
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`✗ ${step.title} · ${message}`);
    return {
      ...base,
      state: "failed",
      durationMs: Date.now() - started,
      message,
      error: typed?.toJSON(),
    };
  }
}

export async function provisionRouter(
  routerId: string,
  store: RouterStore,
  opts: ProvisionOptions = {},
): Promise<ProvisionReport> {
  const dryRun = opts.dryRun ?? false;
  const logger = opts.logger ?? new RouterLogger(dryRun ? "dryrun" : "provision");
  const startedAt = new Date().toISOString();

  const finish = (
    partial: Partial<ProvisionReport> & Pick<ProvisionReport, "ok" | "steps" | "host">,
  ): ProvisionReport => ({
    runId: logger.runId,
    routerId,
    dryRun,
    aborted: false,
    startedAt,
    finishedAt: new Date().toISOString(),
    profile: null,
    blockingReasons: [],
    summary: summarize(partial.steps),
    log: logger.events(),
    ...partial,
  });

  const router = await store.load(routerId);
  if (!router) throw new Error(`Router ${routerId} not found`);

  const creds = store.credentials(router);
  if (!creds) {
    logger.error("Router has no usable API credentials — nothing to do");
    return finish({ ok: false, steps: [], host: router.ipAddress });
  }

  logger.info(
    `${dryRun ? "DRY RUN" : "PROVISIONING"} "${router.name}" (${router.ipAddress})` +
      `${dryRun ? " — no changes will be written" : ""}`,
  );

  // ── Gate: probe before touching anything ──────────────────────────────────
  // A capability the self-test measured as unsupported must survive re-probing, or the dialect
  // reverts to the version guess and this run would apply per-user limits the board rejects.
  const profile: RouterProfile = await probeRouterMerged(creds, logger, router.capabilities);

  if (!profile.compatibility.ok) {
    logger.error("Aborting before any changes — this board cannot run the hotspot");
    return finish({
      ok: false,
      aborted: true,
      steps: [],
      host: router.ipAddress,
      profile,
      blockingReasons: profile.compatibility.reasons,
    });
  }

  let ctx: ProvisionContext;
  try {
    ctx = buildContext(router, profile, dialectFor(profile), dryRun, store.backend);
  } catch (err) {
    // Backend address could not be resolved — a config problem, not a router problem.
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message);
    return finish({
      ok: false,
      aborted: true,
      steps: [],
      host: router.ipAddress,
      profile,
      blockingReasons: [message],
    });
  }

  logger.info(
    `Management ${ctx.endpoints.management.url} · portal ${ctx.endpoints.portal.origin} · hotspot ${ctx.hotspot.network} on ` +
      `${ctx.hotspot.interface} · gateway ${ctx.hotspot.gatewayIp}`,
  );

  if (!dryRun) await store.markProvisioning(routerId);

  const steps: StepResult[] = [];
  let conn: MikroTikConn | null = null;
  let aborted = false;

  try {
    conn = await logger.connect(creds.host, () => connectToRouter(creds));
    const ros = new RosClient(conn, logger, creds.host);

    for (const step of PROVISION_STEPS) {
      if (aborted) {
        steps.push({
          id: step.id,
          title: step.title,
          critical: step.critical,
          state: "skipped",
          durationMs: 0,
          message: "Skipped — an earlier critical step failed",
        });
        continue;
      }

      const result = await runStep(step, ros, ctx, logger);
      steps.push(result);

      if (result.state === "failed" && step.critical) {
        aborted = true;
        logger.error(`Critical step "${step.title}" failed — stopping run`);
      }
    }
  } finally {
    if (conn) await closeConnection(conn);
  }

  const summary = summarize(steps);
  const ok = summary.failed === 0 && !aborted;

  const report = finish({ ok, aborted, steps, host: creds.host, profile });

  if (!dryRun) {
    // Store the outcome without the command transcript — the log can run to hundreds of
    // events and belongs in the response, not the row.
    const { log: _log, ...withoutLog } = report;
    await store.recordProvisionOutcome(router, { ok, profile, report: withoutLog });
  }

  logger.summary(
    `${dryRun ? "Dry run" : "Provisioning"} ${ok ? "OK" : "FAILED"} — ` +
      `${summary.satisfied} already correct, ` +
      `${dryRun ? `${summary.wouldApply} would apply` : `${summary.applied} applied`}, ` +
      `${summary.skipped} skipped, ${summary.failed} failed`,
    summary,
  );

  return report;
}

export type { RouterProfile } from "./probe.js";
export { probeRouter } from "./probe.js";

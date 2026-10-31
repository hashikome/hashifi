import type { RouterJourney, RouterSetupPhase, RouterStage } from "@hashifi/types";
import { PHASE_TITLES, type SetupPhaseId } from "../services/router-provision/setup.js";

/** A run this old with no finish was ended by a restart; setup itself takes minutes. */
export const SETUP_STALE_MS = 10 * 60 * 1000;

/** What a finished setup leaves on the router. */
export interface StoredSetup {
  ok: boolean;
  phases: { id: string; title: string; status: RouterSetupPhase["status"]; detail: string }[];
  blockers: { reason: string; fix: string | null }[];
}

interface JourneyRow {
  status: string;
  setupStartedAt: Date | null;
  setupPhase: string | null;
  lastSetupAt: Date | null;
}

const PHASES = Object.entries(PHASE_TITLES) as [SetupPhaseId, string][];

function runningPhases(current: string | null): RouterSetupPhase[] {
  const at = PHASES.findIndex(([id]) => id === current);
  return PHASES.map(([id, title], index) => ({
    id,
    title,
    status: index < at ? "pass" : index === at ? "running" : "pending",
    detail: null,
  }));
}

function stageOf(row: JourneyRow, ok: boolean | null): RouterStage {
  if (ok === true) return "serving";
  return row.status === "online" ? "set-up" : "connect";
}

/** Decides what an owner sees: the web renders this and decides nothing (ADR-0003). */
export function routerJourney(
  row: JourneyRow,
  last: StoredSetup | null,
  now: Date = new Date(),
): RouterJourney {
  const startedAt = row.setupStartedAt?.getTime() ?? null;
  const interrupted = startedAt !== null && now.getTime() - startedAt > SETUP_STALE_MS;
  const running = startedAt !== null && !interrupted;
  const ok = last?.ok ?? null;
  return {
    stage: stageOf(row, ok),
    connected: row.status === "online",
    running,
    interrupted,
    ok,
    finishedAt: row.lastSetupAt?.toISOString() ?? null,
    phases: running
      ? runningPhases(row.setupPhase)
      : last
        ? last.phases
        : PHASES.map(([id, title]) => ({ id, title, status: "pending", detail: null })),
    blockers: running ? [] : (last?.blockers ?? []),
  };
}

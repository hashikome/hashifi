import { describe, expect, test } from "bun:test";
import { routerJourney, SETUP_STALE_MS, type StoredSetup } from "./router-journey.js";

const now = new Date("2026-11-01T10:00:00Z");
const idle = { status: "offline", setupStartedAt: null, setupPhase: null, lastSetupAt: null };
const passed: StoredSetup = { ok: true, phases: [], blockers: [] };

describe("a router's journey", () => {
  test("starts at connecting, and an online router moves to set up", () => {
    expect(routerJourney(idle, null, now).stage).toBe("connect");
    expect(routerJourney({ ...idle, status: "online" }, null, now).stage).toBe("set-up");
  });

  test("a passed setup is serving, even while the router is briefly unreachable", () => {
    expect(routerJourney(idle, passed, now).stage).toBe("serving");
  });

  test("a failed setup stays at set up and carries what to fix", () => {
    const blockers = [{ reason: "No internet", fix: "Check the uplink" }];
    const journey = routerJourney(
      { ...idle, status: "online" },
      { ok: false, phases: [], blockers },
      now,
    );
    expect(journey.stage).toBe("set-up");
    expect(journey.ok).toBe(false);
    expect(journey.blockers).toEqual(blockers);
  });

  test("a running setup shows finished, current and waiting phases", () => {
    const journey = routerJourney(
      { ...idle, status: "online", setupStartedAt: now, setupPhase: "dry-run" },
      null,
      now,
    );
    expect(journey.running).toBe(true);
    expect(journey.phases.map((p) => p.status)).toEqual([
      "pass",
      "pass",
      "running",
      "pending",
      "pending",
      "pending",
    ]);
  });

  test("a run with no finish after ten minutes was interrupted, and can start again", () => {
    const started = new Date(now.getTime() - SETUP_STALE_MS - 1);
    const journey = routerJourney({ ...idle, setupStartedAt: started }, null, now);
    expect(journey.running).toBe(false);
    expect(journey.interrupted).toBe(true);
  });
});

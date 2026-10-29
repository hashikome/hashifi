import { beforeAll, describe, expect, test } from "bun:test";
import type { LogRecord } from "@logtape/logtape";
import { initializeTelemetry } from "./telemetry.js";
import { enrichWideEvent, withWideEvent } from "./wide-event.js";

const records: LogRecord[] = [];

beforeAll(async () => {
  await initializeTelemetry(
    { environment: "test", release: null, sentryDsn: null, tracesSampleRate: 0 },
    [(record) => records.push(record)],
  );
});

const last = () => records.at(-1)?.properties ?? {};

describe("wide events", () => {
  test("one event per unit of work, with outcome, duration and enrichment", async () => {
    const before = records.length;
    await withWideEvent(
      "router.sync",
      { "job.name": "router-sync", "venue.id": "v1" },
      async () => {
        enrichWideEvent({ "sync.attempted": 2, "sync.succeeded": 2 });
      },
    );
    expect(records.length).toBe(before + 1);
    expect(last()).toMatchObject({
      event: "router.sync",
      "job.name": "router-sync",
      "venue.id": "v1",
      "sync.attempted": 2,
      outcome: "success",
    });
    expect(typeof last().duration_ms).toBe("number");
  });

  test("a failure is recorded, redacted, and re-thrown", async () => {
    await expect(
      withWideEvent("router.provision", { "router.id": "r1" }, async () => {
        throw new Error("RouterOS rejected =name=SIMRX2PJH =password=SIMRX2PJH");
      }),
    ).rejects.toThrow();
    expect(last()).toMatchObject({ outcome: "failure", "error.class": "Error" });
    expect(String(last()["error.message"])).not.toContain("SIMRX2PJH");
  });

  test("a plain logger's message and properties are redacted before any sink", async () => {
    const { getLogger } = await import("@logtape/logtape");
    getLogger(["hashifi", "router-sync"]).error("Push to {router} failed: {error}", {
      router: "home",
      error: "RouterOS rejected /ip/hotspot/user/add =name=SIMRX2PJH",
    });
    const record = records.at(-1);
    expect(JSON.stringify(record?.properties)).not.toContain("SIMRX2PJH");
    expect(record?.message.join("")).not.toContain("SIMRX2PJH");
  });

  test("fields outside the allowlist never reach a sink", async () => {
    await withWideEvent("router.sync", {}, async () => {
      // A caller passing an arbitrary object, bypassing the type, as untyped data might.
      enrichWideEvent({ "voucher.code": "SIMRX2PJH", phone: "+255712345678" } as never);
    });
    expect(JSON.stringify(last())).not.toContain("SIMRX2PJH");
    expect(JSON.stringify(last())).not.toContain("255712345678");
  });
});

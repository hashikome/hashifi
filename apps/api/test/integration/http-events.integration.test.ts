import { beforeAll, describe, expect, test } from "bun:test";
import type { LogRecord } from "@logtape/logtape";
import { initializeTelemetry } from "../../src/observability/telemetry.js";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, requestSignInCode, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const records: LogRecord[] = [];
beforeAll(async () => {
  await initializeTelemetry(
    { environment: "test", release: null, sentryDsn: null, tracesSampleRate: 0 },
    [(record) => records.push(record)],
  );
});

const t = useTestDatabase();
const api = useApi();

/** The HTTP wide events emitted since `from`, waiting briefly: they end when the socket closes. */
async function eventsSince(from: number, count: number) {
  for (let i = 0; i < 50; i++) {
    const events = records
      .slice(from)
      .map((r) => r.properties)
      .filter((p) => p.event === "http.request");
    if (events.length >= count) return events;
    await Bun.sleep(20);
  }
  throw new Error("no HTTP wide event");
}

describe("HTTP wide events", () => {
  test("every request has one, refusals included, with the route pattern and no values", async () => {
    const { id } = await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    const c = browser(api);

    let from = records.length;
    await c.request("GET", "/api/venues");
    expect(await eventsSince(from, 1)).toEqual([
      expect.objectContaining({
        "http.method": "GET",
        "http.route": "/api/venues",
        "http.status_code": 401,
        outcome: "success",
      }),
    ]);

    from = records.length;
    await requestSignInCode(c, "m@example.com");
    expect((await eventsSince(from, 1))[0]).toMatchObject({
      "http.route": "/api/auth/email-otp/send-verification-otp",
      "http.status_code": 200,
    });

    await signInWithCode(api, c, "m@example.com");
    from = records.length;
    const missing = "01a18895-f25f-7622-b47d-8a428187786f";
    await c.request("GET", `/api/venues/${missing}?mac=AA:BB:CC:DD:EE:FF`);
    const [event] = await eventsSince(from, 1);
    expect(event).toMatchObject({
      "http.route": "/api/venues/:id",
      "http.status_code": 404,
      "staff.id": id,
    });
    expect(JSON.stringify(event)).not.toContain(missing);
    expect(JSON.stringify(event)).not.toContain("AA:BB");
  });
});

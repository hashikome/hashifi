import { afterAll, describe, expect, test } from "bun:test";
import { chargeState, SnippeGateway } from "./mobile-money.js";

/** Stands in for the provider: what matters here is exactly what is sent, and read back. */
const seen: { path: string; headers: Headers; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 201, body: {} };

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    seen.push({
      path: new URL(request.url).pathname,
      headers: request.headers,
      body: request.method === "POST" ? await request.json() : null,
    });
    return Response.json(answer.body, { status: answer.status });
  },
});

afterAll(() => server.stop(true));

const gateway = new SnippeGateway(
  "secret-key",
  "https://api.example/webhooks/snippe",
  `http://127.0.0.1:${server.port}`,
);

describe("SnippeGateway", () => {
  test("asks for a payment as the provider documents it", async () => {
    answer = {
      status: 201,
      body: { data: { reference: "ref-1", expires_at: "2026-11-01T05:00:00.000Z" } },
    };
    const charge = await gateway.charge({
      paymentId: "pay-1",
      idempotencyKey: "abc",
      phone: "+255712345678",
      amount: 1000,
    });
    expect(charge).toEqual({
      reference: "ref-1",
      expiresAt: new Date("2026-11-01T05:00:00.000Z"),
    });
    const request = seen.at(-1);
    expect(request?.path).toBe("/v1/payments");
    expect(request?.headers.get("authorization")).toBe("Bearer secret-key");
    expect(request?.headers.get("idempotency-key")).toBe("abc");
    expect(request?.body).toMatchObject({
      payment_type: "mobile",
      details: { amount: 1000, currency: "TZS" },
      phone_number: "255712345678",
      customer: { firstname: "WiFi", lastname: "Guest", email: "guest@hashikome.com" },
      webhook_url: "https://api.example/webhooks/snippe",
      metadata: { payment_id: "pay-1" },
    });
  });

  test("a refusal rejects, rather than looking like a payment", async () => {
    answer = { status: 400, body: { message: "validation_error" } };
    const charge = gateway.charge({
      paymentId: "p",
      idempotencyKey: "k",
      phone: "+255712345678",
      amount: 1000,
    });
    expect(charge).rejects.toThrow("refused");
  });

  test("reads a payment back", async () => {
    answer = {
      status: 200,
      body: { data: { status: "completed", amount: { value: 1000, currency: "TZS" } } },
    };
    expect(await gateway.state("ref-1")).toEqual({
      state: "completed",
      amount: 1000,
      failureReason: null,
    });
    expect(seen.at(-1)?.path).toBe("/v1/payments/ref-1");
    answer = { status: 404, body: {} };
    expect(await gateway.state("nope")).toBeNull();
  });

  test("a status it does not know stays pending, never a guess", () => {
    expect(chargeState("completed")).toBe("completed");
    for (const status of ["failed", "expired", "voided", "cancelled"]) {
      expect(chargeState(status)).toBe("failed");
    }
    expect(chargeState("pending")).toBe("pending");
    expect(chargeState("something-new")).toBe("pending");
  });
});

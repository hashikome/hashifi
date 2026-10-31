import { beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMS_SENDER, type SmsSender } from "../../src/messaging/sms-sender.js";
import { MOBILE_MONEY, type MobileMoneyGateway } from "../../src/payments/mobile-money.js";
import { PaymentsService } from "../../src/payments/payments.service.js";
import { RouterSync } from "../../src/services/router-sync.js";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const PAY_SECRET = "pay-secret";
const SMS_SECRET = "sms-secret";
const MAC = "AA:BB:CC:00:00:02";
const PHONE = "+255712345678";

const t = useTestDatabase();
const api = useApi({
  SNIPPE_WEBHOOK_SECRET: PAY_SECRET,
  BRIQ_WEBHOOK_SECRET: SMS_SECRET,
  SMS_OUTBOX_DIR: join(tmpdir(), `hashifi-sms-${Date.now()}`),
});

let charges: { phone: string; amount: number }[] = [];
let texts: { to: string; text: string }[] = [];
let routerUp = true;
let onNetwork: boolean | null = true;
let deviceIp: string | null = "10.5.50.20";
let signedIn = 0;
let signedInAt = "";
let smsFails = false;
let remote: Awaited<ReturnType<MobileMoneyGateway["state"]>> = null;

beforeEach(() => {
  charges = [];
  texts = [];
  routerUp = true;
  onNetwork = true;
  deviceIp = "10.5.50.20";
  signedIn = 0;
  smsFails = false;
  remote = null;
  const gateway = api.app.get<MobileMoneyGateway>(MOBILE_MONEY, { strict: false });
  gateway.charge = async (request) => {
    charges.push({ phone: request.phone, amount: request.amount });
    return { reference: `ref-${request.paymentId}`, expiresAt: new Date(Date.now() + 3_600_000) };
  };
  gateway.state = async () => remote;
  const sender = api.app.get<SmsSender>(SMS_SENDER, { strict: false });
  sender.send = async (message) => {
    if (smsFails) throw new Error("refused");
    texts.push(message);
    return { jobId: `job-${texts.length}` };
  };
  const sync = api.app.get(RouterSync);
  sync.deviceOnNetwork = async () => onNetwork;
  sync.deviceAddress = async () => deviceIp;
  sync.ensureVoucher = async () => ({
    attempted: 1,
    succeeded: routerUp ? 1 : 0,
    failures: routerUp ? [] : [{ router: "Lobby", error: "unreachable" }],
  });
  sync.signInDevice = async (_router, client) => {
    signedIn += 1;
    signedInAt = client.ip;
    return true;
  };
});

async function setting(price = "2000") {
  const venue = await t.db.venue.create({ data: { name: "Cafe", city: "Dar" } });
  const router = await t.db.router.create({
    data: { venueId: venue.id, name: "Lobby", ipAddress: "192.168.88.2" },
  });
  const pkg = await t.db.package.create({
    data: { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 5, priceTsh: price },
  });
  return { venue, router, pkg };
}

function post(path: string, body: unknown) {
  return fetch(`${api.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
}

const buy = (routerId: string, packageId: string, changes: Record<string, unknown> = {}) =>
  post("/api/guest/payments", {
    router: routerId,
    mac: MAC,
    ip: "10.5.50.20",
    packageId,
    phone: "0712 345 678",
    linkOrig: "http://example.com/?code=WIFI-X",
    ...changes,
  });

const status = (paymentId: string, secret: string) =>
  post("/api/guest/payments/status", { paymentId, secret });

/** A signed report, as sent: `raw` is signed byte for byte. */
function report(raw: string, stamp = Math.floor(Date.now() / 1000), secret = PAY_SECRET) {
  const signature = createHmac("sha256", secret).update(`${stamp}.${raw}`).digest("hex");
  return fetch(`${api.url}/webhooks/snippe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Timestamp": String(stamp),
      "X-Webhook-Signature": signature,
    },
    body: raw,
  });
}

function completed(paymentId: string, id = "evt-1", amount = 2000, currency = "TZS") {
  // Spacing a re-serialised body would lose: the signature must be over these bytes.
  return `{ "id":"${id}",  "type":"payment.completed", "data":{"reference":"ref-${paymentId}",
    "status":"completed","amount":{"value":${amount},"currency":"${currency}"},
    "metadata":{"payment_id":"${paymentId}"}} }`;
}

async function settled() {
  await Bun.sleep(60);
}

async function started(price = "2000") {
  const { router, pkg, venue } = await setting(price);
  const reply = await buy(router.id, pkg.id);
  expect(reply.status).toBe(200);
  const { paymentId, secret } = reply.body as { paymentId: string; secret: string };
  return { paymentId, secret, router, pkg, venue };
}

describe("buying on the portal", () => {
  test("nobody is charged until everything is checked", async () => {
    const { router, pkg } = await setting();
    const other = await t.db.package.create({
      data: { name: "Hidden", durationMinutes: 60, downloadSpeedMbps: 1, priceTsh: "1000" },
    });
    const venue2 = await t.db.venue.create({ data: { name: "Other", city: "Dar" } });
    await t.db.venuePackage.create({ data: { venueId: venue2.id, packageId: pkg.id } });
    await t.db.venuePackage.create({ data: { venueId: router.venueId, packageId: other.id } });
    expect((await buy(router.id, pkg.id)).body).toMatchObject({ code: "PACKAGE_NOT_ON_SALE" });

    expect((await buy(router.id, other.id, { phone: "12345" })).status).toBe(400);
    onNetwork = false;
    expect((await buy(router.id, other.id)).body).toMatchObject({ code: "DEVICE_NOT_ON_NETWORK" });
    onNetwork = true;
    await t.db.device.create({ data: { macAddress: MAC, status: "blocked" } });
    expect((await buy(router.id, other.id)).body).toMatchObject({ code: "DEVICE_BLOCKED" });
    expect(charges).toEqual([]);
    expect(await t.db.payment.count()).toBe(0);
  });

  test("a price under the provider's minimum is not offered for payment", async () => {
    const { router, pkg } = await setting("400");
    expect((await buy(router.id, pkg.id)).body).toMatchObject({ code: "PACKAGE_NOT_PAYABLE" });
  });

  test("a number cannot be prompted again and again", async () => {
    const { router, pkg } = await setting();
    for (let i = 0; i < 3; i++) {
      const device = `AA:BB:CC:00:01:0${i}`;
      expect((await buy(router.id, pkg.id, { mac: device })).status).toBe(200);
    }
    const fourth = await buy(router.id, pkg.id, { mac: "AA:BB:CC:00:01:09" });
    expect(fourth.status).toBe(429);
    expect(charges).toHaveLength(3);
  });

  test("paying issues a voucher, signs the device in, and shows only that session the code", async () => {
    const { paymentId, secret, venue } = await started();
    expect(charges).toEqual([{ phone: PHONE, amount: 2000 }]);
    expect((await status(paymentId, secret)).body).toMatchObject({ state: "pending", code: null });

    expect((await report(completed(paymentId))).status).toBe(200);
    await settled();

    const seen = (await status(paymentId, secret)).body as Record<string, unknown>;
    expect(seen).toMatchObject({ state: "paid", online: true, owed: false, sms: "sent" });
    expect(seen.code).toMatch(/^WIFI-/);
    expect(seen.dst).toBe("http://example.com/");
    expect(signedIn).toBe(1);

    const voucher = await t.db.voucher.findFirstOrThrow();
    expect(voucher).toMatchObject({ status: "active", venueId: venue.id });
    expect(texts).toEqual([{ to: PHONE, text: expect.stringContaining(voucher.code) }]);
    expect(await t.db.customer.findFirstOrThrow()).toMatchObject({ phone: PHONE });

    // Another session has the id at most, and gets nothing, not even that it exists.
    expect((await status(paymentId, "0".repeat(64))).status).toBe(404);
    expect((await post("/api/guest/payments/status", { paymentId })).status).toBe(400);
  });

  test("a forged, unsigned, stale or replayed report changes nothing", async () => {
    const { paymentId } = await started();
    const raw = completed(paymentId);
    expect((await report(raw, undefined, "wrong")).status).toBe(400);
    const unsigned = await fetch(`${api.url}/webhooks/snippe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    });
    expect(unsigned.status).toBe(400);
    const stale = Math.floor(Date.now() / 1000) - 301;
    expect((await report(raw, stale)).status).toBe(400);
    expect(await t.db.voucher.count()).toBe(0);

    await report(raw);
    await report(raw);
    await settled();
    expect(await t.db.voucher.count()).toBe(1);
    expect(await t.db.webhookEvent.count()).toBe(1);
  });

  test("one payment is one voucher, however many finish it at once", async () => {
    const { paymentId } = await started();
    const service = api.app.get(PaymentsService);
    await Promise.all([
      report(completed(paymentId, "evt-a")),
      report(completed(paymentId, "evt-b")),
      service.complete(paymentId, 2000, null),
      service.complete(paymentId, 2000, null),
    ]);
    await settled();
    expect(await t.db.voucher.count()).toBe(1);
    expect(texts).toHaveLength(1);
  });

  test("a report of the wrong amount or currency grants nothing", async () => {
    const { paymentId } = await started();
    await report(completed(paymentId, "evt-1", 500));
    await report(completed(paymentId, "evt-2", 2000, "USD"));
    await settled();
    expect(await t.db.voucher.count()).toBe(0);
    expect(await t.db.payment.findFirstOrThrow()).toMatchObject({ status: "pending" });
  });

  test("a failure ends a payment, but never walks back one that was paid", async () => {
    const { paymentId, secret } = await started();
    const failed = (id: string) =>
      `{"id":"${id}","type":"payment.cancelled","data":{"metadata":{"payment_id":"${paymentId}"}}}`;
    await report(failed("evt-f"));
    expect((await status(paymentId, secret)).body).toMatchObject({ state: "failed", code: null });

    // Money that arrives after all still counts.
    await report(completed(paymentId, "evt-late"));
    await settled();
    await report(failed("evt-g"));
    expect((await status(paymentId, secret)).body).toMatchObject({ state: "paid" });
  });

  test("a lost report is found by asking the provider", async () => {
    const { paymentId } = await started();
    await t.db.payment.update({
      where: { id: paymentId },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    remote = { state: "completed", amount: 2000, failureReason: null };
    await api.app.get(PaymentsService).reconcile();
    await settled();
    expect(await t.db.payment.findFirstOrThrow()).toMatchObject({ status: "paid" });
    expect(signedIn).toBe(1);
  });

  test("paid with the router down is access owed, and recovers", async () => {
    routerUp = false;
    const { paymentId, secret } = await started();
    await report(completed(paymentId));
    await settled();
    await t.db.payment.update({ where: { id: paymentId }, data: { lastCheckedAt: new Date() } });
    const owed = (await status(paymentId, secret)).body as Record<string, unknown>;
    expect(owed).toMatchObject({ state: "paid", owed: true, online: false });
    expect(owed.code).toMatch(/^WIFI-/);
    expect((await t.db.payment.findFirstOrThrow()).provisionError).toContain("unreachable");

    routerUp = true;
    await api.app.get(PaymentsService).reconcile();
    await settled();
    await t.db.payment.update({ where: { id: paymentId }, data: { lastCheckedAt: new Date() } });
    expect((await status(paymentId, secret)).body).toMatchObject({ owed: false, online: true });
    expect(texts).toHaveLength(1);
  });

  test("with SMS failing, the device is online and the screen has the code", async () => {
    smsFails = true;
    const { paymentId, secret } = await started();
    await report(completed(paymentId));
    await settled();
    await t.db.payment.update({ where: { id: paymentId }, data: { lastCheckedAt: new Date() } });
    const seen = (await status(paymentId, secret)).body as Record<string, unknown>;
    expect(seen).toMatchObject({ online: true, sms: "failed" });
    expect(seen.code).toMatch(/^WIFI-/);
  });
});

describe("when things take a while", () => {
  test("a device whose address changed while approving is still let online", async () => {
    const { paymentId } = await started();
    deviceIp = "10.5.50.77";
    await report(completed(paymentId));
    await settled();
    expect(signedInAt).toBe("10.5.50.77");
    expect((await t.db.payment.findFirstOrThrow()).signedInAt).not.toBeNull();
  });

  test("a device that has left keeps its code", async () => {
    const { paymentId, secret } = await started();
    deviceIp = null;
    await report(completed(paymentId));
    await settled();
    await t.db.payment.update({ where: { id: paymentId }, data: { lastCheckedAt: new Date() } });
    const seen = (await status(paymentId, secret)).body;
    expect(seen).toMatchObject({ state: "paid", online: false, owed: false, ended: false });
    expect(seen.code).toMatch(/^WIFI-/);
  });

  test("when the voucher ends the purchase is over, and the code is gone", async () => {
    const { paymentId, secret } = await started();
    await report(completed(paymentId));
    await settled();
    await t.db.voucher.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await t.db.payment.update({ where: { id: paymentId }, data: { lastCheckedAt: new Date() } });
    expect((await status(paymentId, secret)).body).toMatchObject({
      online: false,
      ended: true,
      code: null,
    });
  });

  test("a prompt that nobody answers ends, whatever the provider says", async () => {
    const { paymentId, secret } = await started();
    await t.db.payment.update({
      where: { id: paymentId },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    remote = null;
    await api.app.get(PaymentsService).reconcile();
    await t.db.payment.update({ where: { id: paymentId }, data: { lastCheckedAt: new Date() } });
    expect((await status(paymentId, secret)).body).toMatchObject({ state: "failed" });
  });

  test("stuck payments cannot crowd out a new one", async () => {
    const { paymentId, venue, pkg } = await started();
    const stuck = Array.from({ length: 60 }, (_, i) => ({
      provider: "mobile_money" as const,
      providerReference: `stuck-${i}`,
      amountTsh: "2000",
      packageId: pkg.id,
      venueId: venue.id,
      createdAt: new Date(Date.now() - 3_600_000),
      lastCheckedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    }));
    await t.db.payment.createMany({ data: stuck });
    await t.db.payment.update({
      where: { id: paymentId },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    const gateway = api.app.get<MobileMoneyGateway>(MOBILE_MONEY, { strict: false });
    gateway.state = async (reference) =>
      reference.startsWith("stuck")
        ? null
        : { state: "completed", amount: 2000, failureReason: null };
    await api.app.get(PaymentsService).reconcile();
    expect(await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
      status: "paid",
    });
  });

  test("a report with no ids touches no row", async () => {
    const { paymentId } = await started();
    await report(completed(paymentId));
    await settled();
    const raw = '{"id":"evt_x","event":"sms.delivered","data":{}}';
    const signature = createHmac("sha256", SMS_SECRET).update(raw).digest("hex");
    await fetch(`${api.url}/webhooks/briq`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Briq-Signature": `sha256=${signature}` },
      body: raw,
    });
    expect((await t.db.smsMessage.findFirstOrThrow()).status).toBe("sent");
  });
});

describe("delivery reports", () => {
  function smsReport(raw: string, secret = SMS_SECRET) {
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    return fetch(`${api.url}/webhooks/briq`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Briq-Signature": `sha256=${signature}` },
      body: raw,
    });
  }

  test("signed reports move a message on, once; a silent one ends unconfirmed", async () => {
    const { paymentId } = await started();
    await report(completed(paymentId));
    await settled();
    const sms = () => t.db.smsMessage.findFirstOrThrow();
    const jobId = (await sms()).jobId;

    const sent = `{"id":"evt_1","event":"sms.sent","data":{"job_id":"${jobId}","message_id":"m-1"}}`;
    expect((await smsReport(sent, "wrong")).status).toBe(400);
    expect((await sms()).messageId).toBeNull();
    expect((await smsReport(sent)).status).toBe(200);
    expect(await sms()).toMatchObject({ status: "sent", messageId: "m-1" });

    const delivered = '{"id":"evt_2","event":"sms.delivered","data":{"message_id":"m-1"}}';
    await smsReport(delivered);
    expect((await sms()).status).toBe("delivered");
    // A replay of an older report, or a late one, cannot undo it.
    await smsReport(sent);
    await smsReport('{"id":"evt_3","event":"sms.failed","data":{"message_id":"m-1"}}');
    expect((await sms()).status).toBe("delivered");

    await t.db.smsMessage.update({
      where: { paymentId },
      data: { status: "sent", confirmBy: new Date(Date.now() - 1000) },
    });
    await api.app.get(PaymentsService).reconcile();
    expect((await sms()).status).toBe("unconfirmed");
  });
});

describe("sales and records", () => {
  async function adminClient() {
    await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const c = browser(api);
    await enrollAuthenticatorFor(api, c, "admin@example.com");
    return c;
  }

  test("staff record a sale: the code is theirs to give, and no phone is prompted", async () => {
    const c = await adminClient();
    const { venue, pkg } = await setting();
    const sale = await c.request("POST", "/api/sales", {
      venueId: venue.id,
      packageId: pkg.id,
      method: "cash",
      phone: "0712345678",
    });
    expect(sale.status).toBe(201);
    expect(sale.body).toMatchObject({
      code: expect.stringMatching(/^WIFI-/),
      routerConfirmed: true,
      sms: "sent",
    });
    expect(charges).toEqual([]);
    expect(await t.db.payment.findFirstOrThrow()).toMatchObject({
      provider: "cash",
      status: "paid",
    });

    const unsent = await c.request("POST", "/api/sales", {
      venueId: venue.id,
      packageId: pkg.id,
      method: "cash",
    });
    expect(unsent.body).toMatchObject({ sms: null });
    expect((await t.db.auditLog.findMany()).map((a) => a.action)).toContain("sale_recorded");
  });

  test("a manager sees their own venues' payments and customers, and sells only there", async () => {
    const c = await adminClient();
    const { venue, pkg } = await setting();
    const theirs = await t.db.venue.create({ data: { name: "Theirs", city: "Dar" } });
    const { id } = await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    await t.db.venue.update({ where: { id: theirs.id }, data: { operatorId: id } });
    await c.request("POST", "/api/sales", {
      venueId: venue.id,
      packageId: pkg.id,
      method: "cash",
      phone: "0712345678",
    });
    await c.request("POST", "/api/sales", {
      venueId: theirs.id,
      packageId: pkg.id,
      method: "mobile_money",
      phone: "0754000000",
    });
    expect((await c.request("GET", "/api/payments")).body).toMatchObject({
      payments: [{}, {}],
    });

    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    const mine = (await m.request("GET", "/api/payments")).body as { payments: unknown[] };
    expect(mine.payments).toEqual([expect.objectContaining({ venueName: "Theirs" })]);
    expect((await m.request("GET", "/api/customers")).body).toMatchObject({
      customers: [{ phone: "+255754000000", payments: 1, totalTsh: "2000.00" }],
    });
    const refused = await m.request("POST", "/api/sales", {
      venueId: venue.id,
      packageId: pkg.id,
      method: "cash",
    });
    expect(refused.status).toBe(404);
  });

  test("a paid payment is revenue once, whichever path it took", async () => {
    const c = await adminClient();
    const { venue, pkg } = await setting();
    await c.request("POST", "/api/sales", { venueId: venue.id, packageId: pkg.id, method: "cash" });
    const revenue = await c.request("GET", "/api/revenue/summary");
    expect(JSON.stringify(revenue.body)).toContain("2000");
  });
});

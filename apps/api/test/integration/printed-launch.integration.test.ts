import { describe, expect, test } from "bun:test";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

/** No provider credentials: what launches. Printed vouchers need neither provider. */
const t = useTestDatabase();
const api = useApi();

async function setting() {
  const venue = await t.db.venue.create({ data: { name: "Cafe", city: "Dar" } });
  const router = await t.db.router.create({
    data: { venueId: venue.id, name: "Lobby", ipAddress: "192.168.88.2" },
  });
  const pkg = await t.db.package.create({
    data: { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 5, priceTsh: "2000" },
  });
  return { venue, router, pkg };
}

const post = (path: string, body: unknown) =>
  fetch(`${api.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

describe("without mobile money or SMS", () => {
  test("the portal is for vouchers, and nobody can be charged", async () => {
    const { router, pkg } = await setting();
    const device = { router: router.id, mac: "AA:BB:CC:00:00:03", ip: "10.5.50.20" };
    const context = await post("/api/guest/context", device);
    expect(context.body).toMatchObject({ mobileMoney: false, packages: [{ name: "Day" }] });
    const buying = await post("/api/guest/payments", {
      ...device,
      packageId: pkg.id,
      phone: "0712345678",
    });
    expect(buying.status).toBe(503);
    expect(buying.body).toMatchObject({ code: "PAYMENTS_OFF" });
    expect(await t.db.payment.count()).toBe(0);
  });

  test("staff see what is on, and a sale waits with the rest", async () => {
    await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const c = browser(api);
    await enrollAuthenticatorFor(api, c, "admin@example.com");
    expect((await c.request("GET", "/api/capabilities")).body).toEqual({
      mobileMoney: false,
      sms: false,
    });
    const { venue, pkg } = await setting();
    const sale = await c.request("POST", "/api/sales", {
      venueId: venue.id,
      packageId: pkg.id,
      method: "cash",
    });
    expect(sale.status).toBe(503);

    const batch = await c.request("POST", "/api/vouchers/batches", {
      venueId: venue.id,
      packageId: pkg.id,
      quantity: 2,
    });
    expect(batch.status).toBe(201);
  });
});

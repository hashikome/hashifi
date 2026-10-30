import { describe, expect, test } from "bun:test";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, type Client, enrollAuthenticatorFor, signInWithCode, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi();

async function admin(): Promise<Client> {
  await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
  const c = browser(api);
  await enrollAuthenticatorFor(api, c, "admin@example.com");
  return c;
}

async function manager(email: string): Promise<{ client: Client; id: string }> {
  const { id } = await addStaff(t.db, { email, name: email, role: "manager" });
  const client = browser(api);
  expect((await signInWithCode(api, client, email)).status).toBe(200);
  return { client, id };
}

const DAY = { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 10, priceTsh: 2000 };

type Body = Record<string, unknown>;
const packageOf = (reply: { body: unknown }) => (reply.body as { package: Body }).package;
const details = (reply: { body: unknown }) => (reply.body as { details: Body }).details;

describe("packages", () => {
  test("an admin creates, replaces and deletes a package, each audited", async () => {
    const c = await admin();
    const created = await c.request("POST", "/api/packages", {
      ...DAY,
      features: ["Fast"],
      throttledDownloadMbps: 2,
      peakStartHour: 18,
      peakEndHour: 22,
    });
    expect(created.status).toBe(201);
    expect(packageOf(created)).toMatchObject({
      priceTsh: "2000.00",
      deviceLimit: 1,
      packageType: "hotspot",
      throttledDownloadMbps: 2,
    });
    const id = String(packageOf(created).id);

    // A replacement without the throttle fields clears them.
    const replaced = await c.request("PUT", `/api/packages/${id}`, { ...DAY, priceTsh: 2500 });
    expect(packageOf(replaced)).toMatchObject({
      priceTsh: "2500.00",
      throttledDownloadMbps: null,
      peakStartHour: null,
    });

    expect((await c.request("DELETE", `/api/packages/${id}`)).status).toBe(204);
    const actions = (await t.db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map(
      (entry) => entry.action,
    );
    expect(actions).toEqual(["package_created", "package_updated", "package_deleted"]);
  });

  test("the API enforces the form's rules and the ones that make throttling work", async () => {
    const c = await admin();
    const cases: [Body, string, RegExp][] = [
      [{ priceTsh: 999 }, "priceTsh", /1000/],
      [{ priceTsh: 1500.5 }, "priceTsh", /whole number/],
      [{ durationMinutes: 600_000 }, "durationMinutes", /525600/],
      [
        { throttledDownloadMbps: 10, peakStartHour: 1, peakEndHour: 5 },
        "throttledDownloadMbps",
        /below the download speed/,
      ],
      [
        {
          uploadSpeedMbps: 4,
          throttledDownloadMbps: 2,
          throttledUploadMbps: 4,
          throttleAfterGb: 1,
        },
        "throttledUploadMbps",
        /below the upload speed \(4/,
      ],
      [{ throttledDownloadMbps: 2 }, "throttledDownloadMbps", /peak hours or a data threshold/],
      [{ peakStartHour: 18, peakEndHour: 22 }, "peakStartHour", /throttled download/],
      [{ throttleAfterGb: 2 }, "throttleAfterGb", /throttled download/],
      [{ throttledUploadMbps: 1 }, "throttledUploadMbps", /throttled download/],
      [{ throttledDownloadMbps: 2, peakStartHour: 18 }, "peakEndHour", /both peak hours/],
      [{ throttledDownloadMbps: 2, peakStartHour: 18, peakEndHour: 18 }, "peakEndHour", /differ/],
      [
        { dataLimitGb: 5, throttledDownloadMbps: 2, throttleAfterGb: 5 },
        "throttleAfterGb",
        /data limit \(5/,
      ],
      [{ name: "Two\nlines" }, "name", /one line/],
    ];
    for (const [change, field, message] of cases) {
      const reply = await c.request("POST", "/api/packages", { ...DAY, ...change });
      expect({ change, status: reply.status }).toEqual({ change, status: 400 });
      expect({ change, message: String(details(reply)[field]) }).toEqual({
        change,
        message: expect.stringMatching(message),
      });
    }
    // A night window across midnight is valid.
    const night = await c.request("POST", "/api/packages", {
      ...DAY,
      throttledDownloadMbps: 2,
      peakStartHour: 22,
      peakEndHour: 6,
    });
    expect(night.status).toBe(201);
    expect(await t.db.package.count()).toBe(1);
  });

  test("a package that vouchers still use cannot be deleted", async () => {
    const c = await admin();
    const pkg = await t.db.package.create({ data: DAY });
    await t.db.voucher.create({
      data: { packageId: pkg.id, code: "LIVE01", durationMinutes: 1440, priceTsh: "2000" },
    });
    const refused = await c.request("DELETE", `/api/packages/${pkg.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "PACKAGE_IN_USE" });

    await t.db.voucher.updateMany({ data: { status: "expired" } });
    expect((await c.request("DELETE", `/api/packages/${pkg.id}`)).status).toBe(204);
  });

  test("a manager reads what is on sale and changes nothing", async () => {
    const { client } = await manager("m@example.com");
    const active = await t.db.package.create({ data: DAY });
    const retired = await t.db.package.create({ data: { ...DAY, name: "Old", isActive: false } });

    const list = await client.request("GET", "/api/packages");
    expect((list.body as { packages: Body[] }).packages.map((p) => p.id)).toEqual([active.id]);
    expect((await client.request("GET", `/api/packages/${retired.id}`)).status).toBe(404);
    expect((await client.request("POST", "/api/packages", DAY)).status).toBe(403);
    expect((await client.request("PUT", `/api/packages/${active.id}`, DAY)).status).toBe(403);
    expect((await client.request("DELETE", `/api/packages/${active.id}`)).status).toBe(403);
  });

  test("a venue sells its assigned active packages, or every active one when none are assigned", async () => {
    const c = await admin();
    const own = await manager("own@example.com");
    const venue = await t.db.venue.create({
      data: { name: "Home", city: "Dar es Salaam", operatorId: own.id },
    });
    const other = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
    const day = await t.db.package.create({ data: DAY });
    const week = await t.db.package.create({ data: { ...DAY, name: "Week", priceTsh: 9000 } });
    await t.db.package.create({ data: { ...DAY, name: "Old", isActive: false } });

    const all = await own.client.request("GET", `/api/venues/${venue.id}/packages`);
    expect(all.body).toMatchObject({ sellsAll: true, assignedPackageIds: [] });
    expect((all.body as { packages: Body[] }).packages.map((p) => p.name)).toEqual(["Day", "Week"]);

    const assigned = await c.request("PUT", `/api/venues/${venue.id}/packages/${week.id}`);
    expect(assigned.status).toBe(200);
    await c.request("PUT", `/api/venues/${venue.id}/packages/${week.id}`);
    const one = await own.client.request("GET", `/api/venues/${venue.id}/packages`);
    expect(one.body).toMatchObject({ sellsAll: false, assignedPackageIds: [week.id] });
    expect((one.body as { packages: Body[] }).packages.map((p) => p.id)).toEqual([week.id]);

    // Deactivating an assigned package takes it off sale without making the venue sell all.
    await t.db.package.update({ where: { id: week.id }, data: { isActive: false } });
    const none = await own.client.request("GET", `/api/venues/${venue.id}/packages`);
    expect(none.body).toMatchObject({ sellsAll: false, packages: [] });

    await c.request("DELETE", `/api/venues/${venue.id}/packages/${week.id}`);
    const back = await own.client.request("GET", `/api/venues/${venue.id}/packages`);
    expect(back.body).toMatchObject({ sellsAll: true });
    expect((back.body as { packages: Body[] }).packages.map((p) => p.id)).toEqual([day.id]);

    expect((await own.client.request("GET", `/api/venues/${other.id}/packages`)).status).toBe(404);
    const managerAssign = await own.client.request(
      "PUT",
      `/api/venues/${venue.id}/packages/${day.id}`,
    );
    expect(managerAssign.status).toBe(403);
    const actions = (await t.db.auditLog.findMany()).map((entry) => entry.action);
    expect(actions.sort()).toEqual(["package_assigned", "package_assigned", "package_unassigned"]);
  });
});

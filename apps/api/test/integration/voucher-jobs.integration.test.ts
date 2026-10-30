import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { AuditLog } from "../../src/audit/audit-log.js";
import { SecretBox } from "../../src/crypto/secret-box.js";
import { RouterAccess } from "../../src/services/router-credentials.js";
import { RouterSync } from "../../src/services/router-sync.js";
import { VoucherExpiry } from "../../src/vouchers/voucher-expiry.js";
import { VoucherReconciler } from "../../src/vouchers/voucher-reconciler.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();

function services() {
  const access = new RouterAccess(new SecretBox(randomBytes(32)), 8728, 5);
  const audit = new AuditLog(t.db);
  const sync = new RouterSync(t.db, access, audit);
  return {
    expiry: new VoucherExpiry(t.db, sync),
    reconciler: new VoucherReconciler(t.db, sync, audit),
  };
}

const HOUR = 3_600_000;

/** A venue with no routers, so the jobs exercise the database and never contact a router. */
async function venueWithVouchers(
  vouchers: {
    code: string;
    status: "unused" | "pending_activation" | "active";
    expiresIn: number;
  }[],
) {
  const venue = await t.db.venue.create({ data: { name: "Home", city: "Dar es Salaam" } });
  const pkg = await t.db.package.create({
    data: { name: "Hour", durationMinutes: 60, downloadSpeedMbps: 10, priceTsh: "1000" },
  });
  for (const v of vouchers) {
    await t.db.voucher.create({
      data: {
        code: v.code,
        status: v.status,
        venueId: venue.id,
        packageId: pkg.id,
        priceTsh: "1000",
        expiresAt: new Date(Date.now() + v.expiresIn),
        activatedAt: v.status === "unused" ? null : new Date(Date.now() - HOUR),
      },
    });
  }
  return { venue, pkg };
}

const statusOf = async (code: string) =>
  (await t.db.voucher.findUniqueOrThrow({ where: { code } })).status;

describe("voucher expiry", () => {
  test("active runs out to used; unused lapses to expired; live vouchers are untouched", async () => {
    await venueWithVouchers([
      { code: "WIFI-ACTIVE", status: "active", expiresIn: -60_000 },
      { code: "WIFI-UNUSED", status: "unused", expiresIn: -60_000 },
      { code: "WIFI-LIVE", status: "active", expiresIn: HOUR },
    ]);
    const result = await services().expiry.runOnce();
    expect(result.vouchers).toBe(2);
    expect(await statusOf("WIFI-ACTIVE")).toBe("used");
    expect(await statusOf("WIFI-UNUSED")).toBe("expired");
    expect(await statusOf("WIFI-LIVE")).toBe("active");
  });

  test("an expired pending_activation voucher ends as expired, not stuck (fixed bug)", async () => {
    await venueWithVouchers([
      { code: "WIFI-PENDING", status: "pending_activation", expiresIn: -60_000 },
    ]);
    await services().expiry.runOnce();
    expect(await statusOf("WIFI-PENDING")).toBe("expired");
  });

  test("closes the sessions an expired voucher holds", async () => {
    const { venue } = await venueWithVouchers([
      { code: "WIFI-SESSION", status: "active", expiresIn: -60_000 },
    ]);
    const voucher = await t.db.voucher.findUniqueOrThrow({ where: { code: "WIFI-SESSION" } });
    const session = await t.db.wifiSession.create({
      data: { voucherId: voucher.id, venueId: venue.id, macAddress: "52:54:00:4A:00:10" },
    });
    await services().expiry.runOnce();
    const closed = await t.db.wifiSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(closed.status).toBe("expired");
    expect(closed.endedAt).not.toBeNull();
  });
});

describe("voucher reconciliation", () => {
  test("a stuck voucher with no router to confirm it stays pending and is audited", async () => {
    await venueWithVouchers([
      { code: "WIFI-STUCK", status: "pending_activation", expiresIn: HOUR },
    ]);
    const { reconciler } = services();
    expect((await reconciler.backlog({})).stuckVouchers).toBe(1);
    const result = await reconciler.runOnce();
    expect(result).toEqual({ retried: 1, recovered: 0 });
    expect(await statusOf("WIFI-STUCK")).toBe("pending_activation");
    const audit = await t.db.auditLog.findFirstOrThrow({
      where: { action: "voucher.provision_failed" },
    });
    // The audit trail names the voucher by id: its code is a credential.
    expect(JSON.stringify(audit)).not.toContain("WIFI-STUCK");
  });
});

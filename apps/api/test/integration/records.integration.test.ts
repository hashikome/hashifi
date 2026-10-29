import { describe, expect, test } from "bun:test";
import { packageRecord, voucherRecord } from "../../src/serializers/records.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();

describe("API records from real rows", () => {
  test("money as an exact decimal string, timestamps as UTC ISO, bytes as numbers", async () => {
    const pkg = await t.db.package.create({
      data: { name: "Day", durationMinutes: 1440, downloadSpeedMbps: 20, priceTsh: "2500.5" },
    });
    const venue = await t.db.venue.create({ data: { name: "Home", city: "Dar es Salaam" } });
    const voucher = await t.db.voucher.create({
      data: {
        code: "WIFI-REC",
        venueId: venue.id,
        packageId: pkg.id,
        priceTsh: pkg.priceTsh,
        dataUsedBytes: 5_368_709_120n,
      },
    });

    const p = packageRecord(pkg);
    expect(p.priceTsh).toBe("2500.50");
    expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(p.uploadSpeedMbps).toBeNull();

    const v = voucherRecord(voucher);
    expect(v.dataUsedBytes).toBe(5_368_709_120);
    expect(v.expiresAt).toBeNull();
    // The record is plain JSON: it survives the wire unchanged.
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});

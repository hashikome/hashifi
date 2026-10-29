import { describe, expect, test } from "bun:test";
import { businessDayOf } from "./business-day.js";

describe("businessDayOf", () => {
  test("a business day ends at 21:00 UTC (midnight in Dar es Salaam)", () => {
    expect(businessDayOf(new Date("2026-10-28T20:59:59.999Z"))).toBe("2026-10-28");
    expect(businessDayOf(new Date("2026-10-28T21:00:00.000Z"))).toBe("2026-10-29");
  });

  test("independent of the host's time zone", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(businessDayOf(new Date("2026-10-28T21:30:00Z"))).toBe("2026-10-29");
    } finally {
      process.env.TZ = before;
    }
  });
});

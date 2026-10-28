import { describe, expect, test } from "bun:test";
import {
  DAY,
  HOUR,
  MONTH,
  WEEK,
  durationShort,
  formatDuration,
  minutesToMs,
  minutesToRosUptime,
  splitDuration,
  toMinutes,
} from "./duration.js";

describe("toMinutes", () => {
  test.each([
    [30, "minutes", 30],
    [1, "hours", 60],
    [36, "hours", 2160],
    [1, "days", 1440],
    [1, "weeks", 10080],
    [1, "months", 43200],
  ] as const)("%s %s = %s minutes", (value, unit, expected) => {
    expect(toMinutes(value, unit)).toBe(expected);
  });

  test.each([0, -1, -60, NaN, Infinity])("%s is rejected", (value) => {
    expect(toMinutes(value, "hours")).toBeNull();
  });

  test("a fraction that rounds to zero is rejected, not silently stored as 0", () => {
    // A package with a zero duration would be sold and expire instantly.
    expect(toMinutes(0.4, "minutes")).toBeNull();
  });
});

describe("splitDuration round-trips how a value was entered", () => {
  test.each([
    [30, 30, "minutes"],
    [90, 90, "minutes"], // NOT 1.5 hours
    [60, 1, "hours"],
    [120, 2, "hours"],
    [1440, 1, "days"],
    [2880, 2, "days"],
    [10080, 1, "weeks"],
    [43200, 1, "months"],
    [1500, 25, "hours"], // divides by hour but not by day
  ] as const)("%s minutes → %s %s", (minutes, value, unit) => {
    expect(splitDuration(minutes)).toEqual({ value, unit });
  });

  test("every unit round-trips through toMinutes", () => {
    for (const minutes of [15, 30, 45, 60, 90, 720, 1440, 10080, 43200]) {
      const { value, unit } = splitDuration(minutes);
      expect(toMinutes(value, unit)).toBe(minutes);
    }
  });
});

describe("formatDuration", () => {
  test.each([
    [15, "15 minutes"],
    [60, "1 hour"],
    [120, "2 hours"],
    [1440, "1 day"],
    [10080, "1 week"],
    [43200, "1 month"],
    [90, "90 minutes"],
  ] as const)("%s → %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  test("singular has no trailing s", () => {
    expect(formatDuration(HOUR)).toBe("1 hour");
    expect(formatDuration(DAY)).toBe("1 day");
    expect(formatDuration(WEEK)).toBe("1 week");
    expect(formatDuration(MONTH)).toBe("1 month");
  });
});

describe("durationShort rounds rather than requiring an exact division", () => {
  test.each([
    [30, "30m"],
    [60, "1h"],
    [1440, "1d"],
    [1500, "1d"], // 25 hours — a card showing "1.03d" would be worse
    [10080, "1wk"],
    [43200, "1mo"],
  ] as const)("%s → %s", (minutes, expected) => {
    expect(durationShort(minutes)).toBe(expected);
  });
});

describe("minutesToRosUptime", () => {
  /**
   * This is hardware-level enforcement — the router cuts the user off itself (§13.6) — so a
   * 30-minute voucher must not be emitted as an hour. The hours-only predecessor could only ever
   * produce `HH:00:00`.
   */
  test.each([
    [30, "00:30:00"],
    [45, "00:45:00"],
    [60, "01:00:00"],
    [90, "01:30:00"],
    [1439, "23:59:00"],
    [1440, "1d00:00:00"],
    [1470, "1d00:30:00"],
    [10080, "7d00:00:00"],
  ] as const)("%s minutes → %s", (minutes, expected) => {
    expect(minutesToRosUptime(minutes)).toBe(expected);
  });

  test("always matches RouterOS's [Nd]HH:MM:SS shape", () => {
    for (const m of [1, 30, 59, 60, 61, 1439, 1440, 43200]) {
      expect(minutesToRosUptime(m)).toMatch(/^(\d+d)?\d{2}:\d{2}:\d{2}$/);
    }
  });

  test("never emits a negative or malformed value", () => {
    expect(minutesToRosUptime(0)).toBe("00:00:00");
    expect(minutesToRosUptime(-5)).toBe("00:00:00");
  });
});

describe("minutesToMs", () => {
  test("30 minutes is half an hour of milliseconds", () => {
    expect(minutesToMs(30)).toBe(1_800_000);
  });

  test("an hour matches the old hours × 3_600_000 arithmetic", () => {
    // The expiry maths this replaces was `hours * 3_600_000`.
    for (const hours of [1, 6, 12, 24, 168, 720]) {
      expect(minutesToMs(hours * HOUR)).toBe(hours * 3_600_000);
    }
  });
});

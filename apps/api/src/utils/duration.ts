/**
 * Package and voucher durations, stored as **whole minutes**.
 *
 * They were whole *hours* until 2026-08-12, which made 30-minute bundles impossible to express —
 * the cheapest and most common thing a Tanzanian hotspot sells. `0014_duration_minutes.sql`
 * multiplied every stored value by 60 and renamed the columns, so `durationHours` no longer exists
 * anywhere; if you find one, it is a missed call site.
 *
 * Everything that turns a duration into text or into a RouterOS value goes through this file.
 * Before it existed the same thresholds were reimplemented in `captive-portal.ts` (twice, with
 * different rounding) and in three frontend components, so the portal and the admin list could
 * describe one package differently.
 *
 * A "month" is 30 days, matching the 720-hour convention the presets already used.
 */

export const MINUTE = 1;
export const HOUR = 60;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;

export type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months";

export const UNIT_MINUTES: Record<DurationUnit, number> = {
  minutes: MINUTE,
  hours: HOUR,
  days: DAY,
  weeks: WEEK,
  months: MONTH,
};

/** Whole minutes for `value` of `unit`, or null when the input is not a usable duration. */
export function toMinutes(value: number, unit: DurationUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const minutes = Math.round(value * UNIT_MINUTES[unit]);
  return minutes > 0 ? minutes : null;
}

/**
 * The largest unit that divides `minutes` exactly, so a stored value round-trips back to the way
 * it was entered: 90 stays "90 minutes" rather than becoming "1.5 hours", but 120 becomes
 * "2 hours" and 43200 becomes "1 month".
 */
export function splitDuration(minutes: number): { value: number; unit: DurationUnit } {
  const units: DurationUnit[] = ["months", "weeks", "days", "hours", "minutes"];
  for (const unit of units) {
    const size = UNIT_MINUTES[unit];
    if (minutes >= size && minutes % size === 0) return { value: minutes / size, unit };
  }
  return { value: minutes, unit: "minutes" };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "45 minutes", "1 hour", "2 days", "1 week". For labels and prose. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0 minutes";
  const { value, unit } = splitDuration(minutes);
  return plural(value, unit.slice(0, -1));
}

/**
 * "45m", "1h", "2d", "1wk", "1mo" — for a price card where space is tight.
 *
 * Rounds to the nearest unit rather than requiring an exact division, because a card showing
 * "1.03d" for 25 hours would be worse than showing "1d". `formatDuration` is the exact one.
 */
export function durationShort(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes >= MONTH) return `${Math.round(minutes / MONTH)}mo`;
  if (minutes >= WEEK) return `${Math.round(minutes / WEEK)}wk`;
  if (minutes >= DAY) return `${Math.round(minutes / DAY)}d`;
  if (minutes >= HOUR) return `${Math.round(minutes / HOUR)}h`;
  return `${minutes}m`;
}

/**
 * RouterOS `limit-uptime`, which is `[Nd]HH:MM:SS`.
 *
 * This is the hardware-level enforcement (§13.6) — the router disconnects the user itself when it
 * expires, so it must not round a 30-minute voucher up to an hour. The old hours-only version
 * emitted `HH:00:00` and could not express minutes at all.
 */
export function minutesToRosUptime(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / DAY);
  const hh = String(Math.floor((total % DAY) / HOUR)).padStart(2, "0");
  const mm = String(total % HOUR).padStart(2, "0");
  return days > 0 ? `${days}d${hh}:${mm}:00` : `${hh}:${mm}:00`;
}

/** Milliseconds, for expiry arithmetic. */
export function minutesToMs(minutes: number): number {
  return minutes * 60_000;
}

/**
 * How the captive portal groups packages into its tab strip.
 *
 * Defined here — and mirrored in `frontend/lib/duration.ts` — because the portal HTML is rendered
 * by the backend while the admin's Phone Preview is rendered by the frontend, and the two silently
 * disagreed: the preview still bucketed on the *hour* thresholds (24/168/720) after `0014` made
 * the column minutes, so a 3-minute package landed in "Hourly" and was labelled "3h".
 *
 * `minutes` is its own tab rather than being folded into "Hourly". Sub-hour bundles are a distinct
 * product — sold by the dakika, often the cheapest thing on the card — and burying a 3-minute pass
 * under a tab named "Hourly" is what made it read as three hours.
 *
 * Ranges are half-open: `min <= durationMinutes < max`.
 */
export const DURATION_BUCKETS: {
  key: "minutes" | "hourly" | "daily" | "weekly" | "monthly";
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "minutes", label: "Minutes", min: 0, max: HOUR },
  { key: "hourly", label: "Hourly", min: HOUR, max: DAY },
  { key: "daily", label: "Daily", min: DAY, max: WEEK },
  { key: "weekly", label: "Weekly", min: WEEK, max: MONTH },
  { key: "monthly", label: "Monthly", min: MONTH, max: Infinity },
];

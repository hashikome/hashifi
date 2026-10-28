/**
 * Package and voucher durations, in **whole minutes**.
 *
 * Mirrors `backend/src/utils/duration.ts` — keep the two in step, because the captive portal renders
 * from the backend copy and the admin UI from this one, and a customer comparing the portal card
 * with the admin list must see the same words.
 *
 * Durations were whole *hours* until 2026-08-12 (`0014_duration_minutes.sql`), which made a
 * 30-minute bundle impossible to express. If you find a `durationHours` anywhere, it is a missed
 * call site.
 *
 * This replaces three separate hour-based `formatDuration` copies — in `package-view-dialog.tsx`,
 * `vouchers/page.tsx` and `voucher-preview.tsx` — which had drifted: two used `Math.floor` on
 * weeks and rendered 10 days as "1 week", one capitalised its units, and one pluralised "Week"
 * only above 336 hours so 2 weeks read as "2 Week".
 *
 * A "month" is 30 days, matching the 720-hour convention the presets used.
 */

export const MINUTE = 1
export const HOUR = 60
export const DAY = 24 * HOUR
export const WEEK = 7 * DAY
export const MONTH = 30 * DAY

export type DurationUnit = "minutes" | "hours" | "days" | "weeks" | "months"

export const UNIT_MINUTES: Record<DurationUnit, number> = {
  minutes: MINUTE,
  hours: HOUR,
  days: DAY,
  weeks: WEEK,
  months: MONTH,
}

export const DURATION_UNITS: { value: DurationUnit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
]

/** Whole minutes for `value` of `unit`, or null when the input is not a usable duration. */
export function toMinutes(value: number, unit: DurationUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const minutes = Math.round(value * UNIT_MINUTES[unit])
  return minutes > 0 ? minutes : null
}

/**
 * The largest unit that divides `minutes` exactly, so editing a package shows the duration the way
 * it was entered: 90 stays "90 minutes" rather than becoming "1.5 hours".
 */
export function splitDuration(minutes: number): { value: number; unit: DurationUnit } {
  const units: DurationUnit[] = ["months", "weeks", "days", "hours", "minutes"]
  for (const unit of units) {
    const size = UNIT_MINUTES[unit]
    if (minutes >= size && minutes % size === 0) return { value: minutes / size, unit }
  }
  return { value: minutes, unit: "minutes" }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** "45 minutes", "1 hour", "2 days", "1 week". Returns "—" for a missing duration. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return "—"
  const { value, unit } = splitDuration(minutes)
  return plural(value, unit.slice(0, -1))
}

/** "45m", "1h", "2d", "1wk", "1mo" — where space is tight. Rounds to the nearest unit. */
export function durationShort(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—"
  if (minutes >= MONTH) return `${Math.round(minutes / MONTH)}mo`
  if (minutes >= WEEK) return `${Math.round(minutes / WEEK)}wk`
  if (minutes >= DAY) return `${Math.round(minutes / DAY)}d`
  if (minutes >= HOUR) return `${Math.round(minutes / HOUR)}h`
  return `${minutes}m`
}

/**
 * The presets offered in the package form. Custom values are entered as value + unit, so this list
 * only has to cover what people pick most.
 */
export const DURATION_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 Minutes" },
  { minutes: HOUR, label: "1 Hour" },
  { minutes: 3 * HOUR, label: "3 Hours" },
  { minutes: 6 * HOUR, label: "6 Hours" },
  { minutes: 12 * HOUR, label: "12 Hours" },
  { minutes: DAY, label: "24 Hours" },
  { minutes: WEEK, label: "1 Week" },
  { minutes: MONTH, label: "1 Month" },
]

/**
 * How the captive portal groups packages into its tab strip.
 *
 * Mirrors `DURATION_BUCKETS` in `backend/src/utils/duration.ts`. The portal HTML is rendered by the
 * backend while the admin's Phone Preview is rendered here, and the two silently disagreed: this
 * side still bucketed on the *hour* thresholds (24/168/720) after `0014` made the column minutes,
 * so a 3-minute package landed in "Hourly" and was labelled "3h".
 *
 * `minutes` is its own tab rather than being folded into "Hourly". Sub-hour bundles are a distinct
 * product — sold by the dakika, often the cheapest thing on the card — and burying a 3-minute pass
 * under a tab named "Hourly" is what made it read as three hours.
 *
 * Ranges are half-open: `min <= durationMinutes < max`.
 */
export type DurationBucketKey = "minutes" | "hourly" | "daily" | "weekly" | "monthly"

export const DURATION_BUCKETS: {
  key: DurationBucketKey
  label: string
  min: number
  max: number
}[] = [
  { key: "minutes", label: "Minutes", min: 0, max: HOUR },
  { key: "hourly", label: "Hourly", min: HOUR, max: DAY },
  { key: "daily", label: "Daily", min: DAY, max: WEEK },
  { key: "weekly", label: "Weekly", min: WEEK, max: MONTH },
  { key: "monthly", label: "Monthly", min: MONTH, max: Infinity },
]

/** The bucket a duration belongs to. */
export function bucketFor(minutes: number): DurationBucketKey {
  return DURATION_BUCKETS.find((b) => minutes >= b.min && minutes < b.max)?.key ?? "monthly"
}

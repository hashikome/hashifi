"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DURATION_PRESETS,
  DURATION_UNITS,
  formatDuration,
  splitDuration,
  toMinutes,
  type DurationUnit,
} from "@/lib/duration"

const CUSTOM = "custom"

/**
 * How long a package lasts, in whole minutes.
 *
 * Presets cover the common cases; **Custom** reveals a number and a unit so any duration can be
 * entered. It used to be six hardcoded hour values with no way past them, and the column was an
 * int of hours — so a 30-minute bundle, the cheapest thing a venue sells, was not expressible at
 * all.
 *
 * `value` is the source of truth. A value that matches a preset selects that preset; anything else
 * opens the custom row already filled in with the largest unit that divides it exactly, so 90
 * minutes comes back as "90 minutes" rather than "1.5 hours".
 */
export function DurationField({
  value,
  onChange,
  id = "duration",
  label = "Duration *",
}: {
  /** Whole minutes, or null when nothing has been chosen yet. */
  value: number | null
  onChange: (minutes: number | null) => void
  id?: string
  label?: string
}) {
  const isPreset = (minutes: number) => DURATION_PRESETS.some((p) => p.minutes === minutes)

  const [isCustom, setIsCustom] = useState(value !== null && !isPreset(value))
  const initial =
    value !== null ? splitDuration(value) : { value: 1, unit: "hours" as DurationUnit }
  const [customValue, setCustomValue] = useState(String(initial.value))
  const [unit, setUnit] = useState<DurationUnit>(initial.unit)

  /**
   * The last value this component itself sent up.
   *
   * Without it the re-sync effect below fights the user. Choosing Custom emits whatever the custom
   * row currently shows — `1` + `Hours` = 60 — the effect then sees `value === 60`, notices 60 is
   * also the "1 Hour" preset, and closes the custom row again. The field snapped straight back to
   * "1 Hour", and only *appeared* to work on a second attempt because `value` was already 60 by
   * then, so the effect never re-fired to undo it.
   *
   * Comparing against this ref distinguishes "the parent gave us a new value" from "this is our own
   * change echoing back", which is the only case the effect should act on.
   */
  const lastEmitted = useRef<number | null>(value)

  const emit = (minutes: number | null) => {
    lastEmitted.current = minutes
    onChange(minutes)
  }

  /*
   * Adopt a value that came from outside — the edit page fetches the package after mount, so the
   * first render has value === null and the custom row would otherwise stay closed on a package
   * whose duration is not one of the presets.
   */
  useEffect(() => {
    if (value === null || value === lastEmitted.current) return
    lastEmitted.current = value
    if (isPreset(value)) {
      setIsCustom(false)
      return
    }
    const split = splitDuration(value)
    setIsCustom(true)
    setCustomValue(String(split.value))
    setUnit(split.unit)
    // isPreset is a pure read of a module constant; re-running on it would defeat the ref guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const emitCustom = (rawValue: string, rawUnit: DurationUnit) => {
    // null while the field is empty or invalid, so the form's own "duration is required" check
    // catches it rather than a 0 reaching the API.
    emit(toMinutes(Number(rawValue), rawUnit))
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={isCustom ? CUSTOM : value !== null ? String(value) : ""}
        onValueChange={(v) => {
          if (v === CUSTOM) {
            // Continue from the duration already showing rather than resetting to 1 hour, so
            // switching "24 Hours" to Custom starts at 24 / Hours and can be nudged to 36.
            const seed =
              value !== null ? splitDuration(value) : { value: Number(customValue) || 1, unit }
            setCustomValue(String(seed.value))
            setUnit(seed.unit)
            setIsCustom(true)
            emitCustom(String(seed.value), seed.unit)
            return
          }
          setIsCustom(false)
          emit(Number(v))
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select duration" />
        </SelectTrigger>
        <SelectContent>
          {DURATION_PRESETS.map((p) => (
            <SelectItem key={p.minutes} value={String(p.minutes)}>
              {p.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM}>Custom…</SelectItem>
        </SelectContent>
      </Select>

      {isCustom && (
        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            aria-label="Duration amount"
            className="w-28"
            value={customValue}
            onChange={(e) => {
              setCustomValue(e.target.value)
              emitCustom(e.target.value, unit)
            }}
          />
          <Select
            value={unit}
            onValueChange={(u) => {
              setUnit(u as DurationUnit)
              emitCustom(customValue, u as DurationUnit)
            }}
          >
            <SelectTrigger className="w-36" aria-label="Duration unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATION_UNITS.map((u) => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Always show the resolved duration: "6 weeks" is easy to enter by accident, and the router
          enforces it as limit-uptime with no second chance to notice. */}
      <p className="text-xs text-muted-foreground">
        {value === null ? (
          "Pick a preset, or Custom for any length."
        ) : (
          <>
            Vouchers will last{" "}
            <span className="font-medium text-foreground">{formatDuration(value)}</span>
            {value < 60 ? " — enforced by the router to the minute." : "."}
          </>
        )}
      </p>
    </div>
  )
}

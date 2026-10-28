"use client"

import { useRef, useEffect } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export type MonthValue = { year: number; month: number }

function generateMonths(count = 18): (MonthValue & { label: string })[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1)
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    }
  })
}

interface MonthPickerProps {
  value: MonthValue
  onChange: (m: MonthValue) => void
}

export function MonthPicker({ value, onChange }: MonthPickerProps) {
  const months = generateMonths(18)
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })
  }, [value.year, value.month])

  function scroll(dir: "left" | "right") {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -180 : 180, behavior: "smooth" })
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => scroll("left")}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div
        ref={scrollRef}
        className="flex gap-1.5 overflow-x-auto"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {months.map((m) => {
          const isSelected = m.year === value.year && m.month === value.month
          return (
            <button
              key={`${m.year}-${m.month}`}
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onChange({ year: m.year, month: m.month })}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                isSelected
                  ? "text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              style={isSelected ? { backgroundColor: "var(--chart-1)" } : undefined}
            >
              {m.label}
            </button>
          )
        })}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => scroll("right")}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

export function currentMonth(): MonthValue {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export function monthRange(m: MonthValue): { from: string; to: string } {
  const lastDay = new Date(m.year, m.month, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    from: `${m.year}-${pad(m.month)}-01`,
    to: `${m.year}-${pad(m.month)}-${pad(lastDay)}`,
  }
}

export function monthLabel(m: MonthValue): string {
  return new Date(m.year, m.month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}

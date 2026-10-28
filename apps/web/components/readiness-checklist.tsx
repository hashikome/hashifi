"use client"

import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from "lucide-react"

export type ReadinessStatus = "pass" | "warn" | "fail" | "skipped"

export interface ReadinessCheck {
  id: string
  title: string
  status: ReadinessStatus
  detail: string
  fix?: string
}

export interface ReadinessReport {
  ok: boolean
  checks: ReadinessCheck[]
  summary: { pass: number; warn: number; fail: number; skipped: number }
}

const STYLES: Record<
  ReadinessStatus,
  { icon: typeof CheckCircle2; text: string; border: string; label: string }
> = {
  pass: {
    icon: CheckCircle2,
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-l-emerald-500",
    label: "Ready",
  },
  warn: {
    icon: AlertTriangle,
    text: "text-amber-600 dark:text-amber-400",
    border: "border-l-amber-500",
    label: "Heads-up",
  },
  fail: {
    icon: XCircle,
    text: "text-destructive",
    border: "border-l-destructive",
    label: "Blocking",
  },
  skipped: {
    icon: CircleSlash,
    text: "text-muted-foreground",
    border: "border-l-muted",
    label: "Not checked",
  },
}

const ORDER: ReadinessStatus[] = ["fail", "warn", "skipped", "pass"]

/**
 * The readiness checklist — what would stop this router working, and what to type to fix it.
 *
 * Failures first: on a router with a real problem the admin should not have to scroll past
 * five green ticks to find it.
 */
export function ReadinessChecklist({ report }: { report: ReadinessReport }) {
  const checks = [...report.checks].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  )

  const { pass, warn, fail, skipped } = report.summary

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">
          {fail > 0
            ? `${fail} problem${fail === 1 ? "" : "s"} would stop this working`
            : warn > 0
              ? "Ready, with things to know"
              : "Ready to provision"}
        </span>
        <span className="text-xs text-muted-foreground">
          {pass} ready{warn > 0 && ` · ${warn} heads-up`}
          {fail > 0 && ` · ${fail} blocking`}
          {skipped > 0 && ` · ${skipped} not checked`}
        </span>
      </div>

      <ul className="space-y-1.5">
        {checks.map((c) => {
          const s = STYLES[c.status]
          const Icon = s.icon
          return (
            <li key={c.id} className={`rounded-r-md border-l-2 bg-muted/30 px-3 py-2 ${s.border}`}>
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 size-4 shrink-0 ${s.text}`} />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium leading-snug">{c.title}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                  {c.fix && (
                    <p className={`text-xs ${c.status === "pass" ? "text-muted-foreground" : s.text}`}>
                      {c.fix}
                    </p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

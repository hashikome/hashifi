"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { AlertCircle, Loader, RefreshCw } from "lucide-react"

/**
 * Shown when a load **failed** — never when it merely returned nothing.
 *
 * The distinction matters. Pages used to `toast.error("Failed to load …")` and leave the list
 * empty, so once the toast faded the user was looking at "No venues added yet" — the UI claiming
 * there is no data when in fact the request never succeeded. That is worse than an error: it is
 * a confident wrong answer, and there was no way to retry without a full page reload.
 *
 * Branch on the error *before* the empty check:
 *
 * ```tsx
 * {loadError ? (
 *   <ErrorState message={loadError} onRetry={fetchVenues} isRetrying={isLoading} />
 * ) : venues.length === 0 && !isLoading ? (
 *   <EmptyState icon={Building2} message="No venues added yet." />
 * ) : ( … rows … )}
 * ```
 */
export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  isRetrying = false,
  className = "",
}: {
  title?: string
  message: string
  onRetry?: () => void
  isRetrying?: boolean
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/10 bg-destructive/5 p-6 text-center ${className}`}
    >
      <AlertCircle className="size-8 text-destructive" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        // Per AGENT.md: anything triggering a request shows a loader and disables while in flight.
        <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {isRetrying ? "Retrying…" : "Try again"}
        </Button>
      )}
    </div>
  )
}

/**
 * Shown when a load **succeeded** and there genuinely is nothing yet.
 *
 * `action` is for the "…and here's how to add the first one" CTA, which AGENT.md asks for on
 * actionable empty states.
 */
export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  className = "",
}: {
  icon?: React.ComponentType<{ className?: string }>
  title?: string
  message: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-6 text-center ${className}`}
    >
      {Icon && <Icon className="size-8 text-muted-foreground" />}
      <div className="space-y-1">
        {title && <p className="font-medium text-foreground">{title}</p>}
        <p className="text-muted-foreground">{message}</p>
      </div>
      {action}
    </div>
  )
}

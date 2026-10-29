import { AsyncLocalStorage } from "node:async_hooks";
import { getLogger } from "@logtape/logtape";
import { redact } from "./redact.js";

/**
 * One wide event per unit of work: an HTTP request, or a background job such as a provisioning
 * run, a router sync, or an expiry or reconciliation pass (ADR-0002). The work enriches the
 * event as it goes; it is emitted once, when the work ends, with its outcome and duration.
 *
 * Only allowlisted fields with primitive values are kept. References are ids, never personal
 * data: no voucher codes, phone numbers, emails or MAC addresses.
 */
export const WIDE_EVENT_FIELDS = [
  "operation",
  "outcome",
  "duration_ms",
  "error.class",
  "error.message",
  "http.method",
  "http.route",
  "http.status_code",
  "job.name",
  "venue.id",
  "router.id",
  "package.id",
  "voucher.id",
  "voucher.status",
  "staff.id",
  "router.status",
  "router.ros_version",
  "router.board",
  "provision.applied",
  "provision.failed",
  "provision.skipped",
  "sync.attempted",
  "sync.succeeded",
  "vouchers.expired",
  "sessions.expired",
  "reconcile.retried",
] as const;

export type WideEventField = (typeof WIDE_EVENT_FIELDS)[number];
type Primitive = string | number | boolean;
export type WideEventFields = Partial<Record<WideEventField, Primitive | null>>;
export type WideEventOutcome = "success" | "failure";

const allowed = new Set<string>(WIDE_EVENT_FIELDS);

export class WideEvent {
  private readonly fields = new Map<string, Primitive>();
  private readonly startedAt = performance.now();
  private emitted = false;

  constructor(
    readonly name: string,
    fields: WideEventFields = {},
  ) {
    this.set(fields);
  }

  /** Adds fields; unknown names and null values are ignored. */
  set(fields: WideEventFields): void {
    if (this.emitted) return;
    for (const [key, value] of Object.entries(fields)) {
      if (!allowed.has(key) || value === null || value === undefined) continue;
      this.fields.set(key, typeof value === "string" ? redact(value) : value);
    }
  }

  snapshot(): Record<string, Primitive> {
    return Object.fromEntries(this.fields);
  }

  /** Records the outcome and emits the event once. */
  end(outcome: WideEventOutcome, error: unknown = null): Record<string, Primitive> {
    if (!this.emitted) {
      this.set({ outcome, duration_ms: Math.round(performance.now() - this.startedAt) });
      if (error !== null) {
        this.set({
          "error.class": error instanceof Error ? error.constructor.name : typeof error,
          "error.message": error instanceof Error ? error.message : String(error),
        });
      }
      this.emitted = true;
      const logger = getLogger(["hashifi", "event"]);
      const record = { event: this.name, ...this.snapshot() };
      if (outcome === "success") logger.info(this.name, record);
      else logger.error(this.name, record);
    }
    return this.snapshot();
  }
}

const storage = new AsyncLocalStorage<WideEvent>();

/** The wide event of the work in progress, or null outside one. */
export function currentWideEvent(): WideEvent | null {
  return storage.getStore() ?? null;
}

/**
 * Runs `work` with `event` as the current wide event, for work that ends later than `work`
 * returns (an HTTP request ends when its response finishes). The caller ends the event.
 */
export function runInWideEvent(event: WideEvent, work: () => void): void {
  storage.run(event, work);
}

/** Adds fields to the current wide event, if there is one. */
export function enrichWideEvent(fields: WideEventFields): void {
  storage.getStore()?.set(fields);
}

/**
 * Runs `work` inside a wide event named `name`, emitting it when the work settles. A thrown
 * error marks the event a failure and is re-thrown.
 */
export async function withWideEvent<T>(
  name: string,
  fields: WideEventFields,
  work: (event: WideEvent) => Promise<T>,
): Promise<T> {
  const event = new WideEvent(name, fields);
  try {
    const result = await storage.run(event, () => work(event));
    event.end("success");
    return result;
  } catch (error) {
    event.end("failure", error);
    throw error;
  }
}

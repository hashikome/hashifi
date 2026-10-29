/**
 * Structured, visible logging for everything we send to a RouterOS device.
 *
 * Two consumers:
 *   1. the server console — every command, its params, how long it took, what came back
 *   2. subscribers (admin UI over /ws/live) — same events, as structured objects
 *
 * Nothing talking to a router should call `conn.write()` directly; go through
 * `RouterLogger.run()` so no step is ever silent.
 */

import { randomUUID } from "node:crypto";
import { getLogger } from "@logtape/logtape";
import {
  classifyRouterError,
  RouterError,
  type RouterErrorContext,
  redactParams,
} from "./mikrotik-errors.js";

export type RouterLogLevel = "debug" | "info" | "warn" | "error";
export type RouterLogPhase = "connect" | "command" | "step" | "summary";
export type RouterLogOutcome = "ok" | "failed" | "unsupported" | "skipped";

export interface RouterLogEvent {
  runId: string;
  seq: number;
  at: string;
  level: RouterLogLevel;
  phase: RouterLogPhase;
  scope: string;
  message: string;
  command?: string;
  params?: string[];
  durationMs?: number;
  outcome?: RouterLogOutcome;
  error?: ReturnType<RouterError["toJSON"]>;
  data?: unknown;
}

type Subscriber = (event: RouterLogEvent) => void;

/** Process-wide subscribers. The WS bridge attaches here in Phase 2. */
const globalSubscribers = new Set<Subscriber>();

export function onRouterLog(cb: Subscriber): () => void {
  globalSubscribers.add(cb);
  return () => globalSubscribers.delete(cb);
}

const SYMBOL: Record<RouterLogOutcome, string> = {
  ok: "ok",
  failed: "FAILED",
  unsupported: "UNSUPPORTED",
  skipped: "skipped",
};

// Through LogTape, so the transcript is redacted like every other log (voucher codes are
// hotspot user names); subscribers still receive the structured events.
const transcript = getLogger(["hashifi", "router"]);

function consoleWrite(e: RouterLogEvent): void {
  const tag = `[${e.scope}:${e.runId.slice(0, 4)}]`;
  const ms = e.durationMs !== undefined ? ` (${e.durationMs}ms)` : "";

  if (e.phase === "command") {
    const arrow = e.outcome === "ok" ? "→" : "✗";
    const params = e.params?.length ? ` ${e.params.join(" ")}` : "";
    const status = e.outcome ? ` ${SYMBOL[e.outcome]}` : "";
    const line = `${tag} ${arrow} ${e.command}${params}${ms}${status}`;
    if (e.level === "error") transcript.error(`${line} ${e.error?.rosMessage ?? ""}`.trimEnd());
    else transcript.info(line);
    return;
  }

  const line = `${tag} ${e.message}${ms}`;
  if (e.level === "error") transcript.error(line);
  else if (e.level === "warn") transcript.warn(line);
  else transcript.info(line);
}

export class RouterLogger {
  readonly runId: string;
  readonly scope: string;
  private seq = 0;
  private readonly buffer: RouterLogEvent[] = [];
  private readonly local = new Set<Subscriber>();

  constructor(scope: string, runId: string = randomUUID()) {
    this.scope = scope;
    this.runId = runId;
  }

  subscribe(cb: Subscriber): () => void {
    this.local.add(cb);
    return () => this.local.delete(cb);
  }

  /** Every event emitted by this run, for persisting as a report. */
  events(): readonly RouterLogEvent[] {
    return this.buffer;
  }

  private emit(e: Omit<RouterLogEvent, "runId" | "seq" | "at" | "scope">): RouterLogEvent {
    const event: RouterLogEvent = {
      ...e,
      runId: this.runId,
      seq: this.seq++,
      at: new Date().toISOString(),
      scope: this.scope,
    };
    this.buffer.push(event);
    consoleWrite(event);
    for (const cb of this.local) safeCall(cb, event);
    for (const cb of globalSubscribers) safeCall(cb, event);
    return event;
  }

  info(message: string, data?: unknown): void {
    this.emit({ level: "info", phase: "step", message, data });
  }

  warn(message: string, data?: unknown): void {
    this.emit({ level: "warn", phase: "step", message, data });
  }

  error(message: string, err?: RouterError): void {
    this.emit({ level: "error", phase: "step", message, error: err?.toJSON() });
  }

  summary(message: string, data?: unknown): void {
    this.emit({ level: "info", phase: "summary", message, data });
  }

  /** Wrap a connection attempt so both success and failure are visible and typed. */
  async connect<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    this.emit({ level: "info", phase: "connect", message: `Connecting to ${host}…` });
    try {
      const result = await fn();
      this.emit({
        level: "info",
        phase: "connect",
        message: `Connected to ${host}`,
        durationMs: Date.now() - started,
        outcome: "ok",
      });
      return result;
    } catch (err) {
      const typed = classifyRouterError(err, { host });
      this.emit({
        level: "error",
        phase: "connect",
        message: `Connection to ${host} failed`,
        durationMs: Date.now() - started,
        outcome: "failed",
        error: typed.toJSON(),
      });
      throw typed;
    }
  }

  /**
   * Run one RouterOS command with timing, redaction, and error classification.
   * Throws a typed `RouterError` — never a raw driver error.
   */
  async run<T>(ctx: RouterErrorContext & { command: string }, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    const params = redactParams(ctx.params);
    try {
      const result = await fn();
      this.emit({
        level: "info",
        phase: "command",
        message: ctx.command,
        command: ctx.command,
        params,
        durationMs: Date.now() - started,
        outcome: "ok",
      });
      return result;
    } catch (err) {
      const typed = classifyRouterError(err, { ...ctx, params });
      this.emit({
        level: typed.kind === "unsupported" ? "warn" : "error",
        phase: "command",
        message: ctx.command,
        command: ctx.command,
        params,
        durationMs: Date.now() - started,
        outcome: typed.kind === "unsupported" ? "unsupported" : "failed",
        error: typed.toJSON(),
      });
      throw typed;
    }
  }

  /**
   * Like `run`, but an unsupported command yields `null` instead of throwing.
   * This is how capability probing asks "does this menu exist?" without try/catch noise.
   */
  async probe<T>(
    ctx: RouterErrorContext & { command: string },
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await this.run(ctx, fn);
    } catch (err) {
      if (err instanceof RouterError && err.kind === "unsupported") return null;
      throw err;
    }
  }
}

function safeCall(cb: Subscriber, event: RouterLogEvent): void {
  try {
    cb(event);
  } catch {
    // a broken subscriber must never break the router operation
  }
}

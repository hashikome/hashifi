import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogfmtFormatter,
  type LogRecord,
  type Sink,
} from "@logtape/logtape";
import { getSentrySink } from "@logtape/sentry";
import * as Sentry from "@sentry/bun";
import { redact } from "./redact.js";

export interface TelemetryConfig {
  environment: string;
  release: string | null;
  /** Sentry is off without a DSN; logs still reach the console. */
  sentryDsn: string | null;
  tracesSampleRate: number;
}

let initialization: Promise<void> | null = null;

/**
 * Starts logging and error reporting. Called from the entrypoint before the application is
 * imported, so failures during startup are reported too. Safe to call more than once.
 */
export function initializeTelemetry(config: TelemetryConfig, sinks: Sink[] | null = null) {
  initialization ??= (async () => {
    if (config.sentryDsn) {
      Sentry.init({
        dsn: config.sentryDsn,
        environment: config.environment,
        ...(config.release ? { release: config.release } : {}),
        // Sentry 11 collects all of these by default; every category is off. Wide events carry
        // the allowlisted context, and stack-frame variables could hold voucher codes.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
          mcp: { inputs: false, outputs: false },
          databaseQueryData: false,
          queues: false,
          stackFrameVariables: false,
        },
        tracesSampleRate: config.tracesSampleRate,
        // No automatic capture of requests, console output or queries: wide events carry
        // the allowlisted context, and redaction runs on everything that is sent.
        defaultIntegrations: false,
        beforeSend: scrubEvent,
        // Logs are on by default in Sentry 11; they arrive already allowlisted from the wide
        // events, and are redacted again here as the last line of defence.
        beforeSendLog: (log) => ({
          ...log,
          message: redact(String(log.message)),
          attributes: Object.fromEntries(
            Object.entries(log.attributes ?? {}).map(([k, v]) => [
              k,
              typeof v === "string" ? redact(v) : v,
            ]),
          ),
        }),
      });
    }
    const outputs: Sink[] = sinks ?? [
      getConsoleSink({
        formatter:
          config.environment === "development"
            ? getLogfmtFormatter({ timeZone: null })
            : getJsonLinesFormatter({ properties: "flatten" }),
      }),
    ];
    if (config.sentryDsn && sinks === null) {
      // Sentry receives structured logs; issues come only from captureFailure, so an error-level
      // wide event never opens a second issue.
      outputs.push(
        getSentrySink({
          sentry: { ...Sentry, captureMessage: () => "", captureException: () => "" },
          logs: { level: "info" },
          breadcrumbs: false,
        }),
      );
    }
    // Every record is redacted before any sink sees it, whichever logger wrote it.
    const named = Object.fromEntries(
      outputs.map((sink, i) => [
        `sink${i}`,
        ((record) => {
          try {
            sink(redactRecord(record));
          } catch {
            // Telemetry is never an application failure.
          }
        }) satisfies Sink,
      ]),
    );
    await configure({
      reset: true,
      sinks: named,
      loggers: [
        { category: ["hashifi"], lowestLevel: "info", sinks: Object.keys(named) },
        { category: ["logtape", "meta"], lowestLevel: null, sinks: [] },
      ],
    });
  })();
  return initialization;
}

/** Reports an unexpected failure to Sentry, redacted. Never throws. */
export function captureFailure(error: unknown): void {
  try {
    Sentry.captureException(error);
  } catch {
    // Telemetry is never an application failure.
  }
}

export async function shutdownTelemetry(): Promise<void> {
  try {
    await Sentry.close(2000);
  } catch {
    // Already closed, or never started.
  }
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) return redact(value.message);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v)]));
  }
  return value;
}

/** The record with its message parts, raw message and properties redacted. */
export function redactRecord(record: LogRecord): LogRecord {
  return {
    ...record,
    message: record.message.map(redactValue),
    rawMessage:
      typeof record.rawMessage === "string" ? redact(record.rawMessage) : record.rawMessage,
    properties: Object.fromEntries(
      Object.entries(record.properties).map(([k, v]) => [k, redactValue(v)]),
    ),
  };
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redact(exception.value);
  }
  if (event.message) event.message = redact(event.message);
  delete event.request;
  delete event.user;
  delete event.extra;
  event.breadcrumbs = [];
  return event;
}

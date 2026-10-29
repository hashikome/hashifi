import { loadConfig } from "./config/config.js";
import {
  captureFailure,
  initializeTelemetry,
  shutdownTelemetry,
} from "./observability/telemetry.js";

// Telemetry starts before the application module graph is imported, so a failure while
// building it is reported like any other.
let stopping = false;

async function fail(error: unknown): Promise<void> {
  if (stopping) return;
  stopping = true;
  captureFailure(error);
  console.error("hashifi-api failed:", error instanceof Error ? error.message : error);
  await shutdownTelemetry();
  process.exit(1);
}

process.on("uncaughtException", (error) => void fail(error));
process.on("unhandledRejection", (error) => void fail(error));

async function start(): Promise<void> {
  const config = loadConfig();
  await initializeTelemetry({
    environment: config.environment,
    release: config.telemetry.release,
    sentryDsn: config.telemetry.sentryDsn,
    tracesSampleRate: config.telemetry.tracesSampleRate,
  });
  const { bootstrap } = await import("./main.js");
  const app = await bootstrap(config);
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    await app.close();
    await shutdownTelemetry();
    clearTimeout(deadline);
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}

void start().catch(fail);

import { captureFailure } from "../observability/telemetry.js";
import { withWideEvent } from "../observability/wide-event.js";

/**
 * A background job on a fixed interval, as a wide event per run. A run is skipped while the
 * previous one is still going, so a slow router never stacks runs up; a failure is recorded on
 * its event and the job simply waits for the next interval (no tight retry loop).
 */
export class IntervalJob {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    readonly name: string,
    private readonly intervalMs: number,
    private readonly work: () => Promise<void>,
  ) {}

  start(runNow: boolean): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref?.();
    if (runNow) void this.runOnce();
  }

  /** Runs once now unless a run is in progress; resolves when that run settles. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = withWideEvent(`job.${this.name}`, { "job.name": this.name }, () => this.work())
      .catch((error: unknown) => {
        // Recorded on the wide event and reported as an issue; the next interval tries again.
        captureFailure(error);
      })
      .finally(() => {
        this.running = null;
      });
    await this.running;
  }

  /** Stops scheduling and waits for a run in progress. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}

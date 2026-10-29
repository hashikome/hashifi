import { describe, expect, test } from "bun:test";
import { IntervalJob } from "./interval-job.js";

describe("IntervalJob", () => {
  test("never overlaps a run still in progress", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let runs = 0;
    const job = new IntervalJob("slow", 10, async () => {
      concurrent++;
      runs++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Bun.sleep(60);
      concurrent--;
    });
    job.start(true);
    await Bun.sleep(150);
    await job.stop();
    expect(maxConcurrent).toBe(1);
    expect(runs).toBeGreaterThanOrEqual(2);
  });

  test("a failing run does not stop the job or escape", async () => {
    let runs = 0;
    const job = new IntervalJob("failing", 10, async () => {
      runs++;
      throw new Error("router unreachable");
    });
    job.start(true);
    await Bun.sleep(60);
    await job.stop();
    expect(runs).toBeGreaterThanOrEqual(2);
  });
});

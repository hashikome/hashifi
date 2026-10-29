import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import sharp from "sharp";
import { deleteImageFile, processAndSaveImage, UPLOADS_DIR } from "./image.js";

// sharp is a native addon; this pins that it loads and works under the Bun runtime.
const written: string[] = [];

afterAll(async () => {
  for (const url of written) await deleteImageFile(url);
});

async function sampleImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#d97757" } })
    .png()
    .toBuffer();
}

describe("portal images under Bun", () => {
  test("a logo becomes a 400×400 JPEG", async () => {
    const url = await processAndSaveImage(await sampleImage(1200, 900), "logo");
    written.push(url);
    const meta = await sharp(join(UPLOADS_DIR, url.split("/").pop() ?? "")).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([400, 400]);
  });

  test("a background is fitted inside 1920×1080 and never enlarged", async () => {
    const big = await processAndSaveImage(await sampleImage(3840, 1600), "background");
    const small = await processAndSaveImage(await sampleImage(800, 600), "background");
    written.push(big, small);
    const bigMeta = await sharp(join(UPLOADS_DIR, big.split("/").pop() ?? "")).metadata();
    const smallMeta = await sharp(join(UPLOADS_DIR, small.split("/").pop() ?? "")).metadata();
    expect([bigMeta.width, bigMeta.height]).toEqual([1920, 800]);
    expect([smallMeta.width, smallMeta.height]).toEqual([800, 600]);
  });

  test("anything that is not an image is rejected", async () => {
    await expect(processAndSaveImage(Buffer.from("not an image"), "logo")).rejects.toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { processPortalImage } from "./portal-images.js";

// sharp is a native addon; this pins that it loads and works under the Bun runtime.
async function sampleImage(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#d97757" } })
    .png()
    .withMetadata({ exif: { IFD0: { Copyright: "secret-location" } } })
    .toBuffer();
}

describe("portal images under Bun", () => {
  test("a logo becomes a 400×400 JPEG without the upload's metadata", async () => {
    const logo = await processPortalImage(await sampleImage(1200, 900), "logo");
    const meta = await sharp(logo).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([400, 400]);
    expect(meta.exif).toBeUndefined();
    expect(logo.includes("secret-location")).toBe(false);
  });

  test("a background is fitted inside 1920×1080 and never enlarged", async () => {
    const big = await sharp(
      await processPortalImage(await sampleImage(3840, 1600), "background"),
    ).metadata();
    const small = await sharp(
      await processPortalImage(await sampleImage(800, 600), "background"),
    ).metadata();
    expect([big.width, big.height]).toEqual([1920, 800]);
    expect([small.width, small.height]).toEqual([800, 600]);
  });

  test("anything that is not an image is rejected", async () => {
    await expect(processPortalImage(Buffer.from("not an image"), "logo")).rejects.toThrow();
  });
});

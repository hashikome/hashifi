import sharp from "sharp";

export type PortalImageKind = "logo" | "background";

/** Image types an admin may upload; every one is re-encoded as JPEG. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
/** The upload limit, 10 MB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Turns an upload into the image the portal serves: validated by decoding it (sharp refuses
 * anything that is not an image), turned upright from its EXIF orientation, stripped of all
 * metadata (a phone photo's location among it), resized, and re-encoded as JPEG, so nothing an
 * admin uploads reaches a guest's browser as sent.
 *
 * A logo is cropped to 400×400; a background fits inside 1920×1080 and is never enlarged.
 */
export async function processPortalImage(buffer: Buffer, kind: PortalImageKind): Promise<Buffer> {
  const resize =
    kind === "logo"
      ? { width: 400, height: 400, fit: "cover" as const }
      : { width: 1920, height: 1080, fit: "inside" as const, withoutEnlargement: true };
  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize(resize)
    .jpeg({ quality: kind === "logo" ? 85 : 80 })
    .toBuffer();
}

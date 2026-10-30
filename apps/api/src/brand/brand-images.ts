import sharp from "sharp";

export type BrandImageKind = "logo" | "background";

/** A phone photo fits; anything larger is refused before it is read in full. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const ACCEPTED = new Set(["jpeg", "png", "webp"]);

/** Refused: not one of the accepted image types, or not an image at all. */
export class NotAnImageError extends Error {}

/**
 * Turns an upload into what a guest's phone loads. Nothing arrives as it was sent: the file is
 * decoded (which refuses anything else, SVG with its scripts among it), turned upright, stripped
 * of its metadata (a phone photo's location among it), made small, and re-encoded as WebP, which
 * keeps a logo's transparency.
 */
export async function processBrandImage(
  input: Uint8Array,
  kind: BrandImageKind,
): Promise<Uint8Array> {
  const size = kind === "logo" ? 256 : 1280;
  try {
    const image = sharp(input, { failOn: "error", limitInputPixels: 50_000_000 });
    const { format } = await image.metadata();
    if (!ACCEPTED.has(format)) throw new NotAnImageError();
    return await image
      .rotate()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: kind === "logo" ? 90 : 70 })
      .toBuffer();
  } catch {
    throw new NotAnImageError();
  }
}

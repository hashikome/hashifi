import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "express";
import type { FileFilterCallback } from "multer";
import multer from "multer";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// backend/src/utils → ../../uploads = backend/uploads
export const UPLOADS_DIR = join(__dirname, "../../uploads");

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard limit
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed"));
    }
  },
});

/**
 * Process an uploaded image buffer with sharp:
 *  - Validates it is a real image (sharp throws for garbage input)
 *  - Auto-rotates based on EXIF orientation
 *  - Strips all metadata (EXIF, ICC profiles, etc.)
 *  - Resizes to sensible maximums
 *  - Re-encodes as JPEG to guarantee safe output
 *  - Saves to UPLOADS_DIR with a UUID filename
 *
 * Returns the URL path (e.g. "/uploads/portal-logo-abc.jpg").
 */
export async function processAndSaveImage(
  buffer: Buffer,
  field: "logo" | "background",
): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });

  const filename = `portal-${field}-${randomUUID()}.jpg`;
  const outputPath = join(UPLOADS_DIR, filename);

  // logo → square 400×400 cover crop
  // background → max 1920×1080, preserve aspect ratio, never enlarge
  const resize =
    field === "logo"
      ? { width: 400, height: 400, fit: "cover" as const }
      : { width: 1920, height: 1080, fit: "inside" as const, withoutEnlargement: true };

  await sharp(buffer, { failOn: "error" }) // strict validation
    .rotate() // honour EXIF orientation
    .resize(resize)
    .jpeg({ quality: field === "logo" ? 85 : 80 })
    .toFile(outputPath);

  return `/uploads/${filename}`;
}

/**
 * Safely delete a file that was previously saved by processAndSaveImage.
 * Only accepts paths that match /uploads/portal-(logo|background)-{uuid}.jpg
 * to prevent path traversal.
 */
export async function deleteImageFile(urlPath: string): Promise<void> {
  const safe = /^\/uploads\/portal-(logo|background)-[a-f0-9-]{36}\.jpg$/.test(urlPath);
  if (!safe) return;

  const filename = urlPath.slice("/uploads/".length);
  try {
    await unlink(join(UPLOADS_DIR, filename));
  } catch {
    // Already gone — treat as success
  }
}

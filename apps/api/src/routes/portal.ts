import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { portalSettings } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { asyncRoute } from "../utils/route.js";
import { imageUpload, processAndSaveImage, deleteImageFile } from "../utils/image.js";

const router = Router();

router.use(requireAuth);

const portalSchema = z.object({
  brandName: z.string().trim().min(1, "Brand name is required").max(160),
  logoText: z.string().max(8).default("W"),
  logoUrl: z.string().max(512).nullable().default(null),
  backgroundImageUrl: z.string().max(512).nullable().default(null),
  headline: z.string().max(180).default("Fast & Reliable WiFi"),
  message: z.string().default(""),
  primaryColor: z.string().max(16).default("#D97757"),
  accentColor: z.string().max(16).default("#0F766E"),
  backgroundColor: z.string().max(16).default("#1F2937"),
  backgroundStyle: z.enum(["solid", "soft", "split"]).default("soft"),
  radius: z.number().int().min(0).max(32).default(18),
  voucherLabel: z.string().max(100).default("Enter your voucher code"),
  voucherPrefix: z.string().max(24).default("WIFI"),
  voucherHelp: z.string().default(""),
  ticketTitle: z.string().max(160).default("Internet Access Voucher"),
  ticketFooter: z.string().max(255).default("Thank you for your purchase"),
  requireTerms: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

// ── GET /api/portal ──────────────────────────────────────────────────────────

router.get(
  "/",
  asyncRoute(async (_req, res) => {
    const [settings] = await db.select().from(portalSettings).limit(1);

    if (!settings) {
      res.status(404).json({ error: "No portal settings configured yet" });
      return;
    }

    res.json({ settings: serialize(settings) });
  }),
);

// ── PUT /api/portal ───────────────────────────────────────────────────────────
// Saves all portal fields including logoUrl / backgroundImageUrl.
// Cleans up old image files on disk when URLs are replaced.

router.put(
  "/",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = portalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      return;
    }

    const [existing] = await db
      .select({
        id: portalSettings.id,
        logoUrl: portalSettings.logoUrl,
        backgroundImageUrl: portalSettings.backgroundImageUrl,
      })
      .from(portalSettings)
      .limit(1);

    if (existing) {
      // Delete old images when the stored URLs are being replaced
      if (existing.logoUrl && existing.logoUrl !== parsed.data.logoUrl) {
        await deleteImageFile(existing.logoUrl);
      }
      if (
        existing.backgroundImageUrl &&
        existing.backgroundImageUrl !== parsed.data.backgroundImageUrl
      ) {
        await deleteImageFile(existing.backgroundImageUrl);
      }

      await db.update(portalSettings).set(parsed.data);
    } else {
      await db.insert(portalSettings).values(parsed.data);
    }

    const [updated] = await db.select().from(portalSettings).limit(1);
    res.json({ ok: true, settings: serialize(updated!) });
  }),
);

// ── POST /api/portal/upload ──────────────────────────────────────────────────
// Accepts a multipart/form-data request with:
//   file  — the image file
//   field — "logo" | "background"
//
// Validates the file is a real image, compresses it with sharp,
// saves it to UPLOADS_DIR, and returns the URL path.
// The URL is NOT written to the DB here — the client includes it in the
// next PUT /api/portal so the save is atomic.

router.post(
  "/upload",
  requireRole("admin"),
  // Run multer before the route handler, translating errors to 400 responses
  (req: Request, res: Response, next: NextFunction) => {
    imageUpload.single("file")(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ error: err.message ?? "File upload error" });
        return;
      }
      next();
    });
  },
  asyncRoute(async (req, res) => {
    const field = (req.body as { field?: string })?.field;
    if (field !== "logo" && field !== "background") {
      res.status(400).json({ error: "field must be 'logo' or 'background'" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    let url: string;
    try {
      url = await processAndSaveImage(req.file.buffer, field);
    } catch {
      // sharp throws for corrupt, empty, or non-image buffers
      res.status(400).json({
        error: "Invalid image. Please upload a valid JPEG, PNG, or WebP file.",
      });
      return;
    }

    res.json({ ok: true, url });
  }),
);

// ── DELETE /api/portal/upload ─────────────────────────────────────────────────
// Body: { url: "/uploads/portal-logo-xxx.jpg" }
// Deletes the file from disk. The client clears the URL from its form state
// and the next PUT will persist logoUrl: null to the DB.

router.delete(
  "/upload",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const url = (req.body as { url?: string })?.url;
    if (typeof url !== "string" || !url.startsWith("/uploads/")) {
      res.status(400).json({ error: "Invalid file path" });
      return;
    }

    await deleteImageFile(url);
    res.json({ ok: true });
  }),
);

function serialize(s: typeof portalSettings.$inferSelect) {
  return {
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export { router as portalRouter };

-- AlterTable
ALTER TABLE "portal_settings" DROP COLUMN "background_style";

-- DropEnum
DROP TYPE "portal_background_style";

-- CreateTable
CREATE TABLE "venue_brands" (
    "venue_id" UUID NOT NULL,
    "brand_name" VARCHAR(160) NOT NULL,
    "headline" VARCHAR(180) NOT NULL,
    "message" TEXT NOT NULL,
    "primary_color" VARCHAR(16) NOT NULL,
    "accent_color" VARCHAR(16) NOT NULL,
    "background_color" VARCHAR(16) NOT NULL,
    "radius" INTEGER NOT NULL DEFAULT 18,
    "voucher_label" VARCHAR(100) NOT NULL,
    "voucher_prefix" VARCHAR(12) NOT NULL,
    "voucher_help" TEXT NOT NULL,
    "ticket_title" VARCHAR(160) NOT NULL,
    "ticket_footer" VARCHAR(255) NOT NULL,
    "require_terms" BOOLEAN NOT NULL DEFAULT true,
    "logo_key" VARCHAR(120),
    "background_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venue_brands_pkey" PRIMARY KEY ("venue_id")
);

-- AddForeignKey
ALTER TABLE "venue_brands" ADD CONSTRAINT "venue_brands_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;


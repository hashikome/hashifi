-- CreateEnum
CREATE TYPE "portal_image_kind" AS ENUM ('logo', 'background');

-- DropIndex
DROP INDEX "portal_settings_is_active_idx";

-- AlterTable
ALTER TABLE "portal_settings" ADD COLUMN     "singleton" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "portal_images" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" "portal_image_kind" NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_images_created_at_idx" ON "portal_images"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "portal_settings_singleton_key" ON "portal_settings"("singleton");


-- One branding row: the unique flag above can only ever be true.
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_singleton" CHECK ("singleton");

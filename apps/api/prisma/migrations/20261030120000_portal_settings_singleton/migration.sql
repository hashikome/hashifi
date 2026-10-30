-- One settings row, so saving is an upsert; and no uploaded logo, background or letter mark:
-- HashiFi's logo and images ship with the web (apps/web/public/).
DROP INDEX "portal_settings_is_active_idx";

ALTER TABLE "portal_settings"
  DROP COLUMN "logo_text",
  DROP COLUMN "logo_url",
  DROP COLUMN "background_image_url",
  ADD COLUMN "singleton" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "portal_settings_singleton_key" ON "portal_settings"("singleton");

-- The unique flag above can only ever be true.
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_singleton" CHECK ("singleton");

-- One location field: an address, where given, joins the city rather than being lost.
ALTER TABLE "venues" RENAME COLUMN "city" TO "location";
ALTER TABLE "venues" ALTER COLUMN "location" TYPE VARCHAR(255);
UPDATE "venues" SET "location" = "address" || ', ' || "location" WHERE "address" IS NOT NULL AND "address" <> '';
ALTER TABLE "venues" DROP COLUMN "address";
DROP INDEX "venues_city_idx";

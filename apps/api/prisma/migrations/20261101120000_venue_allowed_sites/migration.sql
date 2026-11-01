-- Sites a venue lets guests open before paying.
ALTER TABLE "venues" ADD COLUMN "allowed_sites" TEXT[] DEFAULT ARRAY[]::TEXT[];

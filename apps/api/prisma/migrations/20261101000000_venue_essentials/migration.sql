-- A venue is a name, a city or town, and an optional address; nothing read the rest.
ALTER TABLE "venues"
  DROP COLUMN "description",
  DROP COLUMN "road",
  DROP COLUMN "street",
  DROP COLUMN "ward",
  DROP COLUMN "district",
  DROP COLUMN "region",
  DROP COLUMN "country",
  DROP COLUMN "postal_code",
  DROP COLUMN "contact_phone",
  DROP COLUMN "contact_email",
  DROP COLUMN "latitude",
  DROP COLUMN "longitude";

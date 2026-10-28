-- Drop the `policies` table — dead schema for a feature that was never built.
--
-- A policies system was designed early on: a `policies` table and a `package_policies` join
-- table. Both were created, but the API route and the UI never were — `/admin/policies` was a
-- five-line redirect to `/admin/packages`, which is where the behaviour actually lives, and
-- nothing outside `schema.ts` referenced either table.
--
-- Both verified empty (0 rows) before dropping, on 2026-08-11. The full column design survives
-- in `0012_baseline.sql` (which predates this drop) if the feature is ever revisited:
--   policies:         name, description, category enum(network|user|security|billing|access),
--                     type enum(restriction|privilege|rule|automation),
--                     priority enum(low|medium|high|critical), is_active,
--                     applies_to/conditions/actions (all JSON string arrays)
--   package_policies: package_id + policy_id, unique on the pair
--
-- Join table first: it has a FK onto `policies`.
DROP TABLE IF EXISTS package_policies;
--> statement-breakpoint
DROP TABLE IF EXISTS policies;

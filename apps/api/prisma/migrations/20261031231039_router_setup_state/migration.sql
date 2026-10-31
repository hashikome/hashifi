-- AlterTable
ALTER TABLE "routers" ADD COLUMN     "last_setup" JSONB,
ADD COLUMN     "last_setup_at" TIMESTAMPTZ(3),
ADD COLUMN     "setup_phase" VARCHAR(20),
ADD COLUMN     "setup_started_at" TIMESTAMPTZ(3);

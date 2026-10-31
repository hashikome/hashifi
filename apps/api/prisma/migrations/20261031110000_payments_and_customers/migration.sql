-- CreateEnum
CREATE TYPE "sms_status" AS ENUM ('sending', 'sent', 'delivered', 'failed', 'unconfirmed');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "destination" TEXT,
ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "idempotency_key" VARCHAR(30),
ADD COLUMN     "ip_address" VARCHAR(45),
ADD COLUMN     "last_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "mac_address" VARCHAR(32),
ADD COLUMN     "recorded_by_id" UUID,
ADD COLUMN     "router_id" UUID,
ADD COLUMN     "session_secret_hash" VARCHAR(64),
ADD COLUMN     "signed_in_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "phone" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("provider","event_id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" UUID NOT NULL,
    "status" "sms_status" NOT NULL DEFAULT 'sending',
    "job_id" VARCHAR(120),
    "message_id" VARCHAR(120),
    "failure_reason" VARCHAR(255),
    "confirm_by" TIMESTAMPTZ(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sms_messages_payment_id_key" ON "sms_messages"("payment_id");

-- CreateIndex
CREATE INDEX "sms_messages_job_id_idx" ON "sms_messages"("job_id");

-- CreateIndex
CREATE INDEX "sms_messages_message_id_idx" ON "sms_messages"("message_id");

-- CreateIndex
CREATE INDEX "sms_messages_status_idx" ON "sms_messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "voucher_devices" (
    "voucher_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_devices_pkey" PRIMARY KEY ("voucher_id","device_id")
);

-- CreateIndex
CREATE INDEX "voucher_devices_device_id_idx" ON "voucher_devices"("device_id");

-- AddForeignKey
ALTER TABLE "voucher_devices" ADD CONSTRAINT "voucher_devices_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_devices" ADD CONSTRAINT "voucher_devices_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


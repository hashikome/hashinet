-- A wrong switch PIN counts against the device that tried it, not the whole voucher (ADR-0015, 4).
ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_pin_wrong_tries";

-- AlterTable
ALTER TABLE "vouchers" DROP COLUMN "pin_locked_at",
DROP COLUMN "pin_wait_until",
DROP COLUMN "pin_wrong_tries";

-- CreateTable
CREATE TABLE "pin_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "voucher_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "wrong_tries" INTEGER NOT NULL DEFAULT 0,
    "wait_until" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pin_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pin_attempts_device_id_idx" ON "pin_attempts"("device_id");

-- CreateIndex
CREATE UNIQUE INDEX "pin_attempts_voucher_id_device_id_key" ON "pin_attempts"("voucher_id", "device_id");

-- AddForeignKey
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "pin_attempts" ADD CONSTRAINT "pin_attempts_wrong_tries" CHECK ("wrong_tries" BETWEEN 0 AND 6);

-- AlterTable
ALTER TABLE "routers" ADD COLUMN     "radius_secret_encrypted" TEXT;

-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "pin_hmac" VARCHAR(64),
ADD COLUMN     "pin_locked_at" TIMESTAMPTZ(3),
ADD COLUMN     "pin_wait_until" TIMESTAMPTZ(3),
ADD COLUMN     "pin_wrong_tries" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "wifi_sessions" ADD COLUMN     "acct_session_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "radius_admissions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "voucher_id" UUID NOT NULL,
    "router_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "mac_address" VARCHAR(32) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radius_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radius_admissions_voucher_id_idx" ON "radius_admissions"("voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "radius_admissions_router_id_mac_address_key" ON "radius_admissions"("router_id", "mac_address");

-- CreateIndex
CREATE UNIQUE INDEX "wifi_sessions_router_id_acct_session_id_key" ON "wifi_sessions"("router_id", "acct_session_id");

-- AddForeignKey
ALTER TABLE "radius_admissions" ADD CONSTRAINT "radius_admissions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radius_admissions" ADD CONSTRAINT "radius_admissions_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radius_admissions" ADD CONSTRAINT "radius_admissions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A PIN is four digits' HMAC; a wait or a lock only follows wrong tries.
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_pin_wrong_tries" CHECK ("pin_wrong_tries" BETWEEN 0 AND 10);

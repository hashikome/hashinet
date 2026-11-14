-- A voucher's price given back while it was not used yet (ADR-0017, 7 and 8).
-- CreateEnum
CREATE TYPE "refund_method" AS ENUM ('cash', 'mobile_money');

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "voucher_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "venue_id" UUID,
    "package_id" UUID,
    "amount_tsh" DECIMAL(12,2) NOT NULL,
    "method" "refund_method" NOT NULL,
    "phone" VARCHAR(32),
    "reference" VARCHAR(80),
    "reason" VARCHAR(200),
    "refunded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_check" CHECK ("amount_tsh" > 0),
    -- Mobile money names the number it went to and the reference from its message.
    CONSTRAINT "refunds_mobile_money_check" CHECK (
      "method" = 'cash' OR ("phone" IS NOT NULL AND "reference" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_voucher_id_key" ON "refunds"("voucher_id");

-- CreateIndex
CREATE INDEX "refunds_venue_id_created_at_idx" ON "refunds"("venue_id", "created_at");

-- CreateIndex
CREATE INDEX "refunds_refunded_by_id_idx" ON "refunds"("refunded_by_id");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_refunded_by_id_fkey" FOREIGN KEY ("refunded_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

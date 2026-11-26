-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "fee_lower_rate_above_tsh" INTEGER NOT NULL DEFAULT 2000000,
ADD COLUMN     "fee_lower_rate_bp" INTEGER NOT NULL DEFAULT 250,
ADD COLUMN     "fee_minimum_tsh" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "fee_rate_bp" INTEGER NOT NULL DEFAULT 500;

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "fee_rate_bp" INTEGER NOT NULL,
    "fee_lower_rate_bp" INTEGER NOT NULL,
    "fee_lower_rate_above_tsh" INTEGER NOT NULL,
    "fee_minimum_tsh" INTEGER NOT NULL,
    "pay_mobile_money" VARCHAR(40),
    "pay_bank_name" VARCHAR(80),
    "pay_bank_account" VARCHAR(40),
    "pay_account_name" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_settings_singleton_key" ON "billing_settings"("singleton");

-- One row, and rates that are a share of a sale (basis points, 0 to 100%).
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_singleton" CHECK ("singleton");
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_fee_terms" CHECK (
  "fee_rate_bp" BETWEEN 0 AND 10000 AND "fee_lower_rate_bp" BETWEEN 0 AND 10000
  AND "fee_lower_rate_above_tsh" >= 0 AND "fee_minimum_tsh" >= 0);
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_fee_terms" CHECK (
  "fee_rate_bp" BETWEEN 0 AND 10000 AND "fee_lower_rate_bp" BETWEEN 0 AND 10000
  AND "fee_lower_rate_above_tsh" >= 0 AND "fee_minimum_tsh" >= 0);

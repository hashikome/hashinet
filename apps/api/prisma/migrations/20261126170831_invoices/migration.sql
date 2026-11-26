-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('monthly_fees', 'onboarding');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" VARCHAR(20) NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "invoice_kind" NOT NULL,
    "period" DATE,
    "venue_id" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "due_on" DATE NOT NULL,
    "total_tsh" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "venue_id" UUID,
    "label" VARCHAR(160) NOT NULL,
    "onboarding_kind" "onboarding_line_kind",
    "net_sales_tsh" INTEGER,
    "served_bp" INTEGER,
    "minimum_tsh" INTEGER,
    "amount_tsh" INTEGER NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_business_id_issued_at_idx" ON "invoices"("business_id", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_business_id_period_key" ON "invoices"("business_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_position_key" ON "invoice_lines"("invoice_id", "position");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One onboarding invoice a venue.
CREATE UNIQUE INDEX "invoices_one_onboarding" ON "invoices"("venue_id") WHERE "kind" = 'onboarding';
-- A month's invoice names its month; an onboarding charge names its venue.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_kind_fields" CHECK (
  ("kind" = 'monthly_fees' AND "period" IS NOT NULL)
  OR ("kind" = 'onboarding' AND "period" IS NULL));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total" CHECK ("total_tsh" > 0);
-- Invoice numbers, one sequence for every kind, never reused.
CREATE SEQUENCE "invoice_number_seq";

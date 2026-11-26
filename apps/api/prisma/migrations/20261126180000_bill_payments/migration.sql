-- CreateEnum
CREATE TYPE "bill_payment_method" AS ENUM ('mobile_money', 'bank_transfer', 'cash');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "due_reminded_at" TIMESTAMPTZ(3);


-- CreateTable
CREATE TABLE "bill_payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "business_id" UUID NOT NULL,
    "amount_tsh" INTEGER NOT NULL,
    "received_on" DATE NOT NULL,
    "method" "bill_payment_method" NOT NULL,
    "reference" VARCHAR(80),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_allocations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_tsh" INTEGER NOT NULL,

    CONSTRAINT "bill_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_payments_business_id_received_on_idx" ON "bill_payments"("business_id", "received_on");

-- CreateIndex
CREATE INDEX "bill_allocations_invoice_id_idx" ON "bill_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_allocations_payment_id_invoice_id_key" ON "bill_allocations"("payment_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "bill_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money is whole and positive; a payment never settles more than it brought.
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_amount" CHECK ("amount_tsh" > 0);
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_amount" CHECK ("amount_tsh" > 0);

-- Each package paid by hand before invoices (slice 3) becomes its onboarding invoice, unless one
-- was issued already, and the payment that settled it, as it was recorded: its amount, its day,
-- how it came. Nothing recorded is lost before the columns go.
DO $$
DECLARE
  r record;
  inv uuid;
  pay uuid;
  total integer;
BEGIN
  FOR r IN
    SELECT o.venue_id, v.business_id, COALESCE(o.confirmed_at, o.paid_at) AS confirmed_at,
           o.paid_at, o.paid_amount_tsh, o.paid_by
    FROM venue_onboardings o JOIN venues v ON v.id = o.venue_id
    WHERE o.paid_at IS NOT NULL AND o.paid_amount_tsh > 0
    ORDER BY o.paid_at
  LOOP
    SELECT COALESCE(SUM(amount_tsh), 0) INTO total
    FROM venue_onboarding_lines WHERE venue_id = r.venue_id;
    CONTINUE WHEN total <= 0;
    SELECT id INTO inv FROM invoices WHERE kind = 'onboarding' AND venue_id = r.venue_id;
    IF inv IS NULL THEN
      INSERT INTO invoices (number, business_id, kind, venue_id, issued_at, due_on, total_tsh, updated_at)
      VALUES (
        'INV-' || to_char(r.confirmed_at AT TIME ZONE 'Africa/Dar_es_Salaam', 'YYYY-MM') || '-'
          || lpad(nextval('invoice_number_seq')::text, 4, '0'),
        r.business_id, 'onboarding', r.venue_id, r.confirmed_at,
        (r.confirmed_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date + 7, total, now())
      RETURNING id INTO inv;
      INSERT INTO invoice_lines (invoice_id, position, venue_id, label, onboarding_kind, amount_tsh)
      SELECT inv, position, venue_id, COALESCE(description, ''), kind, amount_tsh
      FROM venue_onboarding_lines WHERE venue_id = r.venue_id;
    ELSE
      SELECT total_tsh INTO total FROM invoices WHERE id = inv;
    END IF;
    INSERT INTO bill_payments (business_id, amount_tsh, received_on, method, created_at)
    VALUES (r.business_id, r.paid_amount_tsh,
            (r.paid_at AT TIME ZONE 'Africa/Dar_es_Salaam')::date,
            r.paid_by::text::bill_payment_method, r.paid_at)
    RETURNING id INTO pay;
    INSERT INTO bill_allocations (payment_id, invoice_id, amount_tsh)
    VALUES (pay, inv, LEAST(total, r.paid_amount_tsh));
  END LOOP;
END $$;

-- AlterTable
ALTER TABLE "venue_onboardings" DROP COLUMN "paid_amount_tsh",
DROP COLUMN "paid_at",
DROP COLUMN "paid_by";

-- DropEnum
DROP TYPE "onboarding_paid_by";

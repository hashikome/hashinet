-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "cancel_reason" VARCHAR(240),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3);

-- A cancelled onboarding invoice is history: the venue may be invoiced afresh.
DROP INDEX "invoices_one_onboarding";
CREATE UNIQUE INDEX "invoices_one_onboarding" ON "invoices"("venue_id") WHERE "kind" = 'onboarding' AND "cancelled_at" IS NULL;

-- Only an unpaid invoice is cancelled, and a cancelled one says why.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancel_reason" CHECK (("cancelled_at" IS NULL) = ("cancel_reason" IS NULL));

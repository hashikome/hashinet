-- A venue's sites open before paying become rows, with slots for the second and each more: bought
-- once through a site_slot invoice, or granted to the sites already open, which keep working.

-- AlterEnum
ALTER TYPE "invoice_kind" ADD VALUE 'site_slot';

-- AlterTable
ALTER TABLE "billing_settings" ADD COLUMN     "site_slot_tsh" INTEGER NOT NULL DEFAULT 10000;


-- CreateTable
CREATE TABLE "venue_sites" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "venue_id" UUID NOT NULL,
    "host" VARCHAR(253) NOT NULL,
    "note" VARCHAR(120),
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_slots" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "venue_id" UUID NOT NULL,
    "invoice_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "venue_sites_venue_id_created_at_idx" ON "venue_sites"("venue_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "venue_sites_venue_id_host_key" ON "venue_sites"("venue_id", "host");

-- CreateIndex
CREATE UNIQUE INDEX "site_slots_invoice_id_key" ON "site_slots"("invoice_id");

-- CreateIndex
CREATE INDEX "site_slots_venue_id_idx" ON "site_slots"("venue_id");

-- AddForeignKey
ALTER TABLE "venue_sites" ADD CONSTRAINT "venue_sites_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_sites" ADD CONSTRAINT "venue_sites_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_slots" ADD CONSTRAINT "site_slots_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_slots" ADD CONSTRAINT "site_slots_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every kind but a month's fees names no period (written without the new value, which can't be
-- used in the transaction that adds it).
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_kind_fields";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_kind_fields" CHECK (
  ("kind" = 'monthly_fees' AND "period" IS NOT NULL)
  OR ("kind" <> 'monthly_fees' AND "period" IS NULL));

-- Each venue's sites, in the order they were listed; the second and each more get a granted slot.
INSERT INTO "venue_sites" ("venue_id", "host", "created_at")
SELECT v."id", s.host, v."created_at" + (s.n * interval '1 millisecond')
FROM "venues" v, unnest(v."allowed_sites") WITH ORDINALITY AS s(host, n);

INSERT INTO "site_slots" ("venue_id", "created_at")
SELECT v."id", v."created_at"
FROM "venues" v, generate_series(2, cardinality(v."allowed_sites")) AS g(n);

-- AlterTable
ALTER TABLE "venues" DROP COLUMN "allowed_sites";

-- A business keeps its ways to pay, and each venue reads out the one it chose or the business's
-- default (ADR-0017, 4). Each venue's ways move to its business, once each, and the venue keeps the
-- one it listed first.

-- CreateEnum
CREATE TYPE "payment_way_kind" AS ENUM ('lipa_namba', 'mobile_number', 'bank_account');

-- CreateTable
CREATE TABLE "payment_ways" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "business_id" UUID NOT NULL,
    "kind" "payment_way_kind" NOT NULL,
    "provider" VARCHAR(60),
    "number" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "branch" VARCHAR(60),
    "label" VARCHAR(60),
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_ways_pkey" PRIMARY KEY ("id"),
    -- A Lipa namba names no network or bank; the others must. Only a bank account has a branch.
    CONSTRAINT "payment_ways_provider_check" CHECK (("kind" = 'lipa_namba') = ("provider" IS NULL)),
    CONSTRAINT "payment_ways_branch_check" CHECK ("branch" IS NULL OR "kind" = 'bank_account')
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_ways_business_id_id_key" ON "payment_ways"("business_id", "id");

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "default_payment_way_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "paid_through" VARCHAR(60),
ADD COLUMN     "paid_to_name" VARCHAR(120),
ADD COLUMN     "paid_to_number" VARCHAR(40);

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "payment_way_id" UUID;

-- Each business's ways, once each: the same number and name at two venues is one way. A "through"
-- that says Lipa is a Lipa namba; any other was a mobile money network.
INSERT INTO "payment_ways" ("business_id", "kind", "provider", "number", "name", "created_at", "updated_at")
SELECT DISTINCT ON (v."business_id", replace(w."number", ' ', ''), upper(w."name"))
       v."business_id",
       CASE WHEN w."through" ILIKE '%lipa%' THEN 'lipa_namba' ELSE 'mobile_number' END::"payment_way_kind",
       CASE WHEN w."through" ILIKE '%lipa%' THEN NULL ELSE w."through" END,
       w."number", w."name", w."created_at", w."updated_at"
FROM "venue_payment_ways" w
JOIN "venues" v ON v."id" = w."venue_id"
ORDER BY v."business_id", replace(w."number", ' ', ''), upper(w."name"), w."created_at", w."position";

-- Each venue keeps the way it listed first.
UPDATE "venues" v SET "payment_way_id" = p."id"
FROM "venue_payment_ways" w, "payment_ways" p
WHERE w."venue_id" = v."id" AND w."position" = 0
  AND p."business_id" = v."business_id"
  AND replace(p."number", ' ', '') = replace(w."number", ' ', '')
  AND upper(p."name") = upper(w."name");

-- The default is the way most venues use, the oldest on a tie.
UPDATE "businesses" b SET "default_payment_way_id" = d."id"
FROM (
  SELECT DISTINCT ON (p."business_id") p."business_id", p."id"
  FROM "payment_ways" p
  LEFT JOIN "venues" v ON v."payment_way_id" = p."id"
  GROUP BY p."business_id", p."id", p."created_at"
  ORDER BY p."business_id", count(v."id") DESC, p."created_at", p."id"
) d
WHERE d."business_id" = b."id";

-- A venue on the default follows it, so a later change of default reaches it.
UPDATE "venues" v SET "payment_way_id" = NULL
FROM "businesses" b
WHERE b."id" = v."business_id" AND v."payment_way_id" = b."default_payment_way_id";

-- DropTable
DROP TABLE "venue_payment_ways";

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_id_default_payment_way_id_fkey" FOREIGN KEY ("id", "default_payment_way_id") REFERENCES "payment_ways"("business_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_business_id_payment_way_id_fkey" FOREIGN KEY ("business_id", "payment_way_id") REFERENCES "payment_ways"("business_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_ways" ADD CONSTRAINT "payment_ways_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_ways" ADD CONSTRAINT "payment_ways_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

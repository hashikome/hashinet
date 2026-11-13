-- CreateEnum
CREATE TYPE "onboarding_plan" AS ENUM ('connect', 'install', 'launch');

-- CreateEnum
CREATE TYPE "onboarding_paid_by" AS ENUM ('cash', 'mobile_money', 'bank_transfer');

-- AlterTable
ALTER TABLE "issue_events" ADD COLUMN     "data" JSONB;

-- CreateTable
CREATE TABLE "venue_onboardings" (
    "venue_id" UUID NOT NULL,
    "preferred_at" TIMESTAMPTZ(3),
    "preference" "onboarding_plan",
    "plan" "onboarding_plan",
    "router_model" VARCHAR(120),
    "price_tsh" INTEGER,
    "note" VARCHAR(1000),
    "confirmed_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "paid_amount_tsh" INTEGER,
    "paid_by" "onboarding_paid_by",
    "setup_date" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venue_onboardings_pkey" PRIMARY KEY ("venue_id")
);

-- AddForeignKey
ALTER TABLE "venue_onboardings" ADD CONSTRAINT "venue_onboardings_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venue_onboardings" ADD CONSTRAINT "venue_onboardings_price" CHECK ("price_tsh" IS NULL OR "price_tsh" >= 0);
ALTER TABLE "venue_onboardings" ADD CONSTRAINT "venue_onboardings_paid" CHECK ("paid_amount_tsh" IS NULL OR "paid_amount_tsh" > 0);

-- Venues from before onboarding: one with a router already went through it by hand; one without
-- starts at its package, as a venue does when it is created.
INSERT INTO "venue_onboardings" ("venue_id", "completed_at", "updated_at")
SELECT v."id",
       CASE WHEN EXISTS (SELECT 1 FROM "routers" r WHERE r."venue_id" = v."id") THEN CURRENT_TIMESTAMP END,
       CURRENT_TIMESTAMP
FROM "venues" v;

WITH opened AS (
  INSERT INTO "issues" ("scope", "business_id", "kind", "key", "venue_id", "updated_at")
  SELECT 'platform', NULL, 'venue_package', 'venue-package:' || o."venue_id", o."venue_id", CURRENT_TIMESTAMP
  FROM "venue_onboardings" o
  WHERE o."completed_at" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "issues" i
      WHERE i."scope" = 'platform' AND i."key" = 'venue-package:' || o."venue_id" AND i."status" = 'open'
    )
  RETURNING "id"
)
INSERT INTO "issue_events" ("issue_id", "action")
SELECT "id", 'opened' FROM opened;

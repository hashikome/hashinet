-- A venue follows its business's packages unless it sets its own price or stops selling one, and
-- a venue's own packages sell only there (ADR-0011, 4). A venue that sold only the packages
-- assigned to it keeps selling just those: the others become "not sold here".

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "venue_id" UUID;

-- AlterTable
ALTER TABLE "venue_packages" ADD COLUMN     "on_sale" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "price_tsh" DECIMAL(12,2),
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A venue's own price, like any price, is never below zero.
ALTER TABLE "venue_packages" ADD CONSTRAINT "venue_packages_price_check" CHECK ("price_tsh" IS NULL OR "price_tsh" >= 0);

-- Venues that had assignments: the business's packages not assigned there are not sold there.
INSERT INTO "venue_packages" ("venue_id", "package_id", "on_sale")
SELECT v."id", p."id", false
FROM "venues" v
JOIN "packages" p ON p."business_id" = v."business_id"
WHERE EXISTS (SELECT 1 FROM "venue_packages" a WHERE a."venue_id" = v."id")
  AND NOT EXISTS (SELECT 1 FROM "venue_packages" a WHERE a."venue_id" = v."id" AND a."package_id" = p."id");

-- The assignments themselves now say only what following the business says: on sale, its price.
DELETE FROM "venue_packages" WHERE "on_sale" AND "price_tsh" IS NULL;

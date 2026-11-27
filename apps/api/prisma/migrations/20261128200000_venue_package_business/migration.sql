-- A venue's own package belongs to that venue's business: the foreign key holds both, so a
-- package can't be another business's venue's.

-- DropForeignKey
ALTER TABLE "packages" DROP CONSTRAINT "packages_venue_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "venues_id_business_id_key" ON "venues"("id", "business_id");

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_venue_id_business_id_fkey" FOREIGN KEY ("venue_id", "business_id") REFERENCES "venues"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;


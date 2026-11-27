-- A business's logo (ADR-0009): shown at the head of its admin and on the portal of a venue
-- without its own.

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "logo_key" VARCHAR(120);


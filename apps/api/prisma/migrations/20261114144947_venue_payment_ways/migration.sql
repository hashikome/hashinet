-- Where guests pay a venue by mobile money at its counter: up to three ways (ADR-0017, 4).
-- CreateTable
CREATE TABLE "venue_payment_ways" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "venue_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "through" VARCHAR(60) NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venue_payment_ways_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "venue_payment_ways_position_check" CHECK ("position" BETWEEN 0 AND 2)
);

-- CreateIndex
CREATE UNIQUE INDEX "venue_payment_ways_venue_id_position_key" ON "venue_payment_ways"("venue_id", "position");

-- AddForeignKey
ALTER TABLE "venue_payment_ways" ADD CONSTRAINT "venue_payment_ways_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

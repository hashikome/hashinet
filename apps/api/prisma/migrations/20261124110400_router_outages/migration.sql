-- CreateEnum
CREATE TYPE "outage_kind" AS ENUM ('offline', 'no_internet');

-- AlterTable
ALTER TABLE "routers" ADD COLUMN     "internet_fails" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "internet_ok" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "internet_seen_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "given_back_minutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "router_outages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "router_id" UUID NOT NULL,
    "kind" "outage_kind" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "given_back_at" TIMESTAMPTZ(3),

    CONSTRAINT "router_outages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "router_outages_router_id_started_at_idx" ON "router_outages"("router_id", "started_at");

-- AddForeignKey
ALTER TABLE "router_outages" ADD CONSTRAINT "router_outages_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One open outage per router: the monitor that opens it can run twice at once.
CREATE UNIQUE INDEX "router_outages_one_open" ON "router_outages"("router_id") WHERE "ended_at" IS NULL;

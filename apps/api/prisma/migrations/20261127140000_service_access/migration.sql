-- Service access follows a business's bills, or is held by hand (ADR-0014, 2 and 4).

-- CreateEnum
CREATE TYPE "service_access" AS ENUM ('enabled', 'grace_period', 'read_only', 'suspended');

-- CreateEnum
CREATE TYPE "service_access_reason" AS ENUM ('payment_overdue', 'payment_received', 'payment_arranged', 'policy_violation', 'customer_request', 'contract_ended', 'issue_resolved', 'other');

-- AlterEnum
ALTER TYPE "issue_kind" ADD VALUE 'selling_paused';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "access" "service_access" NOT NULL DEFAULT 'enabled',
ADD COLUMN     "access_held" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "access_held_until" DATE,
ADD COLUMN     "access_since" TIMESTAMPTZ(3),
ADD COLUMN     "access_pauses_on" DATE;

-- CreateTable
CREATE TABLE "service_access_changes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "business_id" UUID NOT NULL,
    "access" "service_access" NOT NULL,
    "held" BOOLEAN NOT NULL,
    "held_until" DATE,
    "reason" "service_access_reason" NOT NULL,
    "note" VARCHAR(500),
    "message" VARCHAR(500),
    "by_id" UUID,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_access_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_access_changes_business_id_at_idx" ON "service_access_changes"("business_id", "at");

-- AddForeignKey
ALTER TABLE "service_access_changes" ADD CONSTRAINT "service_access_changes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_access_changes" ADD CONSTRAINT "service_access_changes_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A date to hold until belongs only to a hold.
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_access_held_until_check" CHECK ("access_held" OR "access_held_until" IS NULL);
ALTER TABLE "service_access_changes" ADD CONSTRAINT "service_access_changes_held_until_check" CHECK ("held" OR "held_until" IS NULL);

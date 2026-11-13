-- CreateEnum
CREATE TYPE "issue_kind" AS ENUM ('router_offline', 'venue_package', 'venue_setup');

-- CreateEnum
CREATE TYPE "issue_status" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "issue_action" AS ENUM ('opened', 'claimed', 'released', 'handed', 'taken_over', 'noted', 'step', 'resolved');

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "scope" "membership_scope" NOT NULL,
    "business_id" UUID,
    "kind" "issue_kind" NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "status" "issue_status" NOT NULL DEFAULT 'open',
    "venue_id" UUID,
    "router_id" UUID,
    "holder_id" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "issue_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "action" "issue_action" NOT NULL,
    "to_id" UUID,
    "note" VARCHAR(500),

    CONSTRAINT "issue_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issues_scope_business_id_status_idx" ON "issues"("scope", "business_id", "status");

-- CreateIndex
CREATE INDEX "issue_events_issue_id_at_idx" ON "issue_events"("issue_id", "at");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_events" ADD CONSTRAINT "issue_events_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A workspace is the platform (no business) or one business.
ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace" CHECK (
  ("scope" = 'platform' AND "business_id" IS NULL) OR ("scope" = 'business' AND "business_id" IS NOT NULL)
);
-- At most one open issue per key in a workspace.
CREATE UNIQUE INDEX "issues_open_key" ON "issues" ("scope", "business_id", "key") NULLS NOT DISTINCT
  WHERE "status" = 'open';

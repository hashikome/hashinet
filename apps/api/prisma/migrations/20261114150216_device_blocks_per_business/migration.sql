-- Blocking is a business's own (slice 2): a device kept off one business's WiFi stays welcome at
-- another's. Each device blocked before is blocked at every business where it was seen.
CREATE TABLE "device_blocks" (
    "business_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "blocked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_blocks_pkey" PRIMARY KEY ("business_id","device_id")
);

CREATE INDEX "device_blocks_device_id_idx" ON "device_blocks"("device_id");

ALTER TABLE "device_blocks" ADD CONSTRAINT "device_blocks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_blocks" ADD CONSTRAINT "device_blocks_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_blocks" ADD CONSTRAINT "device_blocks_blocked_by_id_fkey" FOREIGN KEY ("blocked_by_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "device_blocks" ("business_id", "device_id")
SELECT DISTINCT v."business_id", d."id"
FROM "devices" d
JOIN "wifi_sessions" s ON s."device_id" = d."id"
JOIN "venues" v ON v."id" = s."venue_id"
WHERE d."status" = 'blocked';

DROP INDEX "devices_status_idx";
ALTER TABLE "devices" DROP COLUMN "status";
DROP TYPE "device_status";

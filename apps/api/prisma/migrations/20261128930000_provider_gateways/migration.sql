-- Each payment and text records the provider that took it, so its checks and reports go back to
-- that provider after a switch.
ALTER TABLE "payments" ADD COLUMN "gateway" VARCHAR(30);
ALTER TABLE "sms_messages" ADD COLUMN "gateway" VARCHAR(30);

-- Rows from before: the development stand-in's references start "fake-"; Snippe was the only other.
UPDATE "payments" SET "gateway" = CASE WHEN "provider_reference" LIKE 'fake-%' THEN 'fake' ELSE 'snippe' END
  WHERE "provider" = 'mobile_money' AND "provider_reference" IS NOT NULL;
-- BRIQ texts have a job; the development outbox's have none.
UPDATE "sms_messages" SET "gateway" = CASE WHEN "job_id" IS NULL THEN 'outbox' ELSE 'briq' END;

-- Events are keyed by area and provider (`payments:snippe`), since event ids are unique per
-- provider only. Earlier keys named only the area.
ALTER TABLE "webhook_events" ALTER COLUMN "provider" TYPE VARCHAR(40);
UPDATE "webhook_events" SET "provider" = 'payments:snippe' WHERE "provider" = 'payments';
UPDATE "webhook_events" SET "provider" = 'sms:briq' WHERE "provider" = 'sms';

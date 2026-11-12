-- When a session last proved the person's protection: changing it needs proof from the last 2 hours.
ALTER TABLE "sessions" ADD COLUMN "proved_at" TIMESTAMPTZ(3);

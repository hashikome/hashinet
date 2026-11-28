-- The switch PIN made when a paying device is signed in, sealed, until its session reads it once.
ALTER TABLE "payments" ADD COLUMN "switch_pin_sealed" TEXT;

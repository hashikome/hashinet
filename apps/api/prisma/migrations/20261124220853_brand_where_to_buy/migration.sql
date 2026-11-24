-- Where a guest with no voucher buys one in person, and a number to reach the seller (slice 2k).
-- The column is renamed, keeping what a venue wrote; the old default, which told a guest to ask at
-- a counter they may not know, gives way to the portal's own "at the venue".
ALTER TABLE "portal_settings" RENAME COLUMN "voucher_help" TO "where_to_buy";
ALTER TABLE "portal_settings" ADD COLUMN "contact_phone" VARCHAR(20);
UPDATE "portal_settings" SET "where_to_buy" = '' WHERE "where_to_buy" = 'Ask at the counter for a voucher.';

ALTER TABLE "venue_brands" RENAME COLUMN "voucher_help" TO "where_to_buy";
ALTER TABLE "venue_brands" ADD COLUMN "contact_phone" VARCHAR(20);
UPDATE "venue_brands" SET "where_to_buy" = '' WHERE "where_to_buy" = 'Ask at the counter for a voucher.';

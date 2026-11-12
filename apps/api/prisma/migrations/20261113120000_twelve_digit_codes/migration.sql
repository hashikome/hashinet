-- Voucher codes are 12 digits with no prefix (ADR-0008), so the prefixes go, with their CHECKs.
ALTER TABLE "voucher_batches" DROP COLUMN "prefix";
ALTER TABLE "portal_settings" DROP COLUMN "voucher_prefix";
ALTER TABLE "venue_brands" DROP COLUMN "voucher_prefix";

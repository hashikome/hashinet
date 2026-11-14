-- A voucher exists only by its sale (ADR-0017): no printed batches, and a wrong sale is refunded,
-- never revoked. Batches made before are test data only; their vouchers stay, without a batch.
ALTER TYPE "voucher_status" RENAME VALUE 'revoked' TO 'refunded';
ALTER TABLE "vouchers" RENAME COLUMN "revoked_at" TO "refunded_at";
ALTER TABLE "vouchers" DROP COLUMN "batch_id";
DROP TABLE "voucher_batches";

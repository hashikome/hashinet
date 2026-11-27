-- AlterTable
ALTER TABLE "passkeys" ADD COLUMN     "last_used_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "proved_with" "sign_in_method";

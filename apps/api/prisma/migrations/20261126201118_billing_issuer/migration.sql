-- AlterTable
ALTER TABLE "billing_settings" ADD COLUMN     "issuer_email" VARCHAR(160),
ADD COLUMN     "issuer_office" VARCHAR(160),
ADD COLUMN     "issuer_postal" VARCHAR(160),
ADD COLUMN     "issuer_registration" VARCHAR(40),
ADD COLUMN     "issuer_tin" VARCHAR(20),
ADD COLUMN     "pay_bank_branch" VARCHAR(80),
ADD COLUMN     "pay_bank_swift" VARCHAR(11),
ADD COLUMN     "pay_mobile_money_name" VARCHAR(160);

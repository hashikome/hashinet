-- A voucher's wrong PINs from any devices, and the wait they start, kept on the voucher with its PIN.
ALTER TABLE "vouchers" ADD COLUMN     "pin_wait_until" TIMESTAMPTZ(3),
ADD COLUMN     "wrong_pins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wrong_pins_since" TIMESTAMPTZ(3);

ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_wrong_pins" CHECK ("wrong_pins" BETWEEN 0 AND 15);

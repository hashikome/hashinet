-- A Lipa namba belongs to a provider (a network or a bank), which the seller names: "M-Pesa Lipa
-- namba". Ways added before this have none until someone changes them; a mobile money number and
-- a bank account still always name theirs.
ALTER TABLE "payment_ways" DROP CONSTRAINT "payment_ways_provider_check";
ALTER TABLE "payment_ways" ADD CONSTRAINT "payment_ways_provider_check"
  CHECK ("kind" = 'lipa_namba' OR "provider" IS NOT NULL);

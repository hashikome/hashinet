-- TSh 500 is the lowest price of a voucher, so of a package and of a platform default package.
ALTER TABLE "packages" ADD CONSTRAINT "packages_minimum_price" CHECK ("price_tsh" >= 500);
ALTER TABLE "platform_default_packages" ADD CONSTRAINT "platform_default_packages_minimum_price" CHECK ("price_tsh" >= 500);
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_minimum_price" CHECK ("price_tsh" >= 500);

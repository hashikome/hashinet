"use client";

import { Head } from "@/components/ui/ui";
import { PaymentWays } from "@/components/venues/payment-ways";
import { useCan } from "@/lib/session";

/** Settings › Payments (prototype `paydetails`): where guests pay the business at its counters. */
export default function PaymentsSettingsPage() {
  const can = useCan();
  return (
    <>
      <Head
        title="Payments"
        sub="Where guests pay your business when they don't pay cash: whoever sells reads out their venue's way to pay."
      />
      <PaymentWays edit={can("payment_way.manage")} />
    </>
  );
}

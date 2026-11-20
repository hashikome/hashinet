"use client";

import type { VenueResponse } from "@hashinet/types";
import { use } from "react";
import { PaymentDetails } from "@/components/hearth/payment-details";
import { Head } from "@/components/hearth/ui";
import { api } from "@/lib/api";
import { LoadFailed, useLoad } from "@/lib/load";
import { useCan } from "@/lib/session";

/**
 * A business's venue (prototype `venue`): where it is, and where its guests pay at the counter.
 * Its brand, prices and sites come with slice 5's venue page.
 */
export default function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const data = useLoad("venue", () => api.get<VenueResponse>(`/api/venues/${id}`), [id]);
  if (data.error) return <LoadFailed error={data.error} retry={data.reload} />;
  if (!data.data) return null;
  const { venue } = data.data;
  return (
    <>
      <Head title={venue.name} sub={`${venue.area}, ${venue.region}`} />
      <PaymentDetails venueId={venue.id} edit={can("payment_details.update")} />
    </>
  );
}

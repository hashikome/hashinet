import type { Metadata } from "next";
import { AcceptInvitation } from "./accept";

export const metadata: Metadata = {
  title: "Your invitation · HashiNet",
  robots: { index: false, follow: false },
  // The token is in the fragment, which never leaves the browser; no referrer either.
  referrer: "no-referrer",
};

export default function InvitePage() {
  return <AcceptInvitation />;
}

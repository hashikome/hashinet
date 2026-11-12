import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/hearth/ui";
import { SessionProvider } from "@/lib/session";

export const metadata: Metadata = { robots: { index: false } };

/** Everything behind sign-in: the API says who this is, or the page goes to sign-in. */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}

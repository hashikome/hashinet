import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/ui";
import { LoadProvider } from "@/lib/load";
import { SessionProvider } from "@/lib/session";

export const metadata: Metadata = { robots: { index: false } };

/** Everything behind sign-in: the API says who this is, or the page goes to sign-in. */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <LoadProvider>
      <SessionProvider>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </LoadProvider>
  );
}

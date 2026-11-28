import type { ReactNode } from "react";
import { AlwaysDark } from "@/components/ui/always-dark";

/** Sign-in and invitations: always dark (DESIGN.md), before anyone has a theme of their own. */
export default function SignedOutLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AlwaysDark />
      {children}
    </>
  );
}

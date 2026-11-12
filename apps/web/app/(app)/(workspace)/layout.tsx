"use client";

import type { ReactNode } from "react";
import { ProtectGate } from "@/components/hearth/protect";
import { Shell } from "@/components/hearth/shell";
import { useSession } from "@/lib/session";
import { VenuesProvider } from "@/lib/venues";

/**
 * A workspace's pages, on the shell. A session that may reach only Account and security (ADR-0011,
 * 9) sees what to do instead of the page.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return (
    <VenuesProvider>
      {(venues) =>
        venues === null ? null : (
          <Shell me={me} venues={venues}>
            {me.active.access === "account" ? <ProtectGate /> : children}
          </Shell>
        )
      }
    </VenuesProvider>
  );
}

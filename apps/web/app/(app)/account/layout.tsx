"use client";

import type { ReactNode } from "react";
import { Shell } from "@/components/hearth/shell";
import { ButtonLink, Head } from "@/components/hearth/ui";
import { homeOf } from "@/lib/nav";
import { useSession } from "@/lib/session";

const TABS = [
  { href: "/account", label: "Profile" },
  { href: "/account/sign-in", label: "Sign-in" },
  { href: "/account/appearance", label: "Appearance" },
];

/**
 * Account and security: the person's own, in every workspace, on HashiNet's frame (the mark with
 * the Account tag). Reachable by every session, before set-up too (ADR-0011, 9).
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const gated = me.active.access === "account";
  return (
    <Shell me={me} space="Account" nav={TABS}>
      <Head
        title="Account and security"
        sub="These follow you in every workspace."
        actions={
          gated ? null : (
            <ButtonLink href={homeOf(me)}>
              Back to {me.active.scope === "platform" ? "Businesses" : "Overview"}
            </ButtonLink>
          )
        }
      />
      {children}
    </Shell>
  );
}

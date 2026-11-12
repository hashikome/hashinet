"use client";

import type { ReactNode } from "react";
import { Shell } from "@/components/hearth/shell";
import { helpFor } from "@/lib/help";
import type { NavEntry } from "@/lib/nav";
import { useSession } from "@/lib/session";

/** Help: HashiNet's own space, on the dashboard's frame, with the reader's guides by area. */
export default function HelpLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { guides, areas } = helpFor(me);
  const nav: NavEntry[] = [
    { href: "/help", label: "Start here" },
    ...areas.flatMap((area) => [
      { heading: area },
      ...guides
        .filter((g) => g.area === area)
        .map((g) => ({ href: `/help/${g.id}`, label: g.title })),
    ]),
  ];
  return (
    <Shell me={me} space="Help" nav={nav}>
      {children}
    </Shell>
  );
}

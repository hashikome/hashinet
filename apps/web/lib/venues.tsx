"use client";

import type { VenueList, VenueRecord } from "@hashinet/types";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useSession } from "./session";

interface Venues {
  /** Every venue the workspace reaches. */
  all: VenueRecord[];
  /** The venue filter: one venue's id, or "all". */
  filter: string;
  setFilter: (id: string) => void;
  /** The venues in view after the filter. */
  shown: VenueRecord[];
}

const VenuesContext = createContext<Venues>({
  all: [],
  filter: "all",
  setFilter: () => {},
  shown: [],
});

/** The venues the workspace reaches, for the menu, the venue filter and the pages. */
export function VenuesProvider({
  children,
}: {
  children: (venues: VenueRecord[] | null) => ReactNode;
}) {
  const { me } = useSession();
  const [all, setAll] = useState<VenueRecord[] | null>(null);
  const [filter, setFilter] = useState("all");
  const reads = me.active.capabilities.includes("venue.read") && me.active.scope === "business";
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the workspace changes
  useEffect(() => {
    setFilter("all");
    if (!reads) {
      setAll([]);
      return;
    }
    let live = true;
    api
      .get<VenueList>("/api/venues")
      .then((list) => live && setAll(list.venues))
      .catch(() => live && setAll([]));
    return () => {
      live = false;
    };
  }, [reads, me.active.id]);
  const value = useMemo(() => {
    const list = all ?? [];
    return {
      all: list,
      filter,
      setFilter,
      shown: filter === "all" ? list : list.filter((v) => v.id === filter),
    };
  }, [all, filter]);
  return <VenuesContext.Provider value={value}>{children(all)}</VenuesContext.Provider>;
}

export const useVenues = () => useContext(VenuesContext);

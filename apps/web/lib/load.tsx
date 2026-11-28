"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DependencyList, type ReactNode, useCallback, useState } from "react";
import { Attention, Button } from "@/components/ui/ui";
import { messageOf } from "./api";

/**
 * The pages' shared memory of what they loaded (stale-while-revalidate): a page shows what it last
 * loaded at once and asks again in the background, on every visit and when the tab comes back. A
 * failure is shown at once, with Try again, rather than retried behind the person's back.
 */
export function LoadProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 0, retry: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Loads what a page shows. `name` and `deps` say what it is: loads with the same name and deps
 * share what was loaded (Today's figures on Overview and Payments). `data` is null only until the
 * first answer; a failure is `error`, never an empty page; `reload` asks again; `set` keeps what a
 * change answered with.
 */
export function useLoad<T>(name: string, load: () => Promise<T>, deps: DependencyList) {
  const client = useQueryClient();
  const key = keyOf(name, deps);
  const query = useQuery({ queryKey: key, queryFn: load });
  const { refetch } = query;
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);
  return {
    data: query.data ?? null,
    error: query.error === null ? null : messageOf(query.error),
    reload,
    /** What a change answered with, shown at once without asking again. */
    set: (data: T) => client.setQueryData(key, data),
    at: query.dataUpdatedAt === 0 ? null : new Date(query.dataUpdatedAt),
  };
}

const keyOf = (name: string, deps: DependencyList) => [name, ...deps];

/**
 * Loads ahead what a screen is about to show (the Sell dialog's packages), under the key `useLoad`
 * gives the same name and deps, so the screen opens with it.
 */
export function usePrefetch(): <T>(
  name: string,
  load: () => Promise<T>,
  deps: DependencyList,
) => void {
  const client = useQueryClient();
  return useCallback(
    (name, load, deps) => void client.prefetchQuery({ queryKey: keyOf(name, deps), queryFn: load }),
    [client],
  );
}

/**
 * After a change other screens show (a sale, a refund), every load on screen asks again in the
 * background, keeping what it shows until the answer comes.
 */
export function useRefreshAll(): () => void {
  const client = useQueryClient();
  return useCallback(() => void client.invalidateQueries(), [client]);
}

/** Forgets everything loaded, when the workspace changes or the person signs out. */
export function useForgetAll(): () => void {
  const client = useQueryClient();
  return useCallback(() => client.clear(), [client]);
}

/** A load that failed: what happened, and Try again. */
export function LoadFailed({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Attention title="This didn't load" bad action={<Button onClick={retry}>Try again</Button>}>
      {error}
    </Attention>
  );
}

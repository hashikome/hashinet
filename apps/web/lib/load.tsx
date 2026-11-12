"use client";

import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";
import { Attention, Button } from "@/components/hearth/ui";
import { messageOf } from "./api";

/**
 * Loads what a page shows. `data` is null until it arrives; a failure is `error`, never an empty
 * page, and `reload` asks again (after a change, or from the failure's Try again).
 */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const latest = useRef(load);
  latest.current = load;
  // The caller names what the load depends on; it runs again when any of them changes.
  const key = JSON.stringify(deps);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the caller's dependencies
  const run = useCallback(async () => {
    try {
      const next = await latest.current();
      setData(next);
      setError(null);
      setAt(new Date());
    } catch (e) {
      setError(messageOf(e));
    }
  }, [key]);
  useEffect(() => {
    void run();
  }, [run]);
  return { data, error, reload: run, at };
}

/** A load that failed: what happened, and Try again. */
export function LoadFailed({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Attention title="This didn't load" bad action={<Button onClick={retry}>Try again</Button>}>
      {error}
    </Attention>
  );
}

"use client";

import type { Me } from "@hashinet/types";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiRequestError, api } from "./api";
import { LoadFailed } from "./load";
import { homeOf } from "./nav";
import { applyTheme } from "./theme";

interface Session {
  me: Me;
  /** Asks the API again, after anything that changes who this is or what they may do. */
  refresh: () => Promise<Me | null>;
  replace: (me: Me) => void;
  signOut: () => Promise<void>;
  /** Acts as another of the person's workspaces, then opens its overview. */
  switchTo: (membershipId: string) => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Who is signed in, from `GET /api/me`: the API alone decides, and the web draws what `capabilities`
 * allows. Signed out, it goes to sign-in, returning here afterwards.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const load = useCallback(async (): Promise<Me | null> => {
    try {
      const next = await api.get<Me>("/api/me");
      applyTheme(next.theme);
      setMe(next);
      setUnreachable(false);
      return next;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        const back = `${location.pathname}${location.search}`;
        router.replace(back === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(back)}`);
        return null;
      }
      setUnreachable(true);
      return null;
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = useCallback((next: Me) => {
    applyTheme(next.theme);
    setMe(next);
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/sign-out").catch(() => undefined);
    router.replace("/sign-in");
  }, [router]);

  const switchTo = useCallback(
    async (membershipId: string) => {
      await api.post("/api/me/membership", { membershipId });
      const next = await load();
      // The new workspace's own home: a business's Overview, or HashiNet's Businesses.
      if (next) router.push(homeOf(next));
    },
    [load, router],
  );

  const value = useMemo(
    () => (me ? { me, refresh: load, replace, signOut, switchTo } : null),
    [me, load, replace, signOut, switchTo],
  );
  if (value === null) {
    return unreachable ? (
      <main className="canvas unreachable">
        <LoadFailed
          error="HashiNet can't be reached. Check the connection, then try again."
          retry={() => void load()}
        />
      </main>
    ) : null;
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error("useSession must be used within a SessionProvider");
  return session;
}

/** Whether the active workspace may do `action` (the API's policy names). */
export function useCan(): (action: string) => boolean {
  const { me } = useSession();
  return useCallback((action: string) => me.active.capabilities.includes(action), [me]);
}

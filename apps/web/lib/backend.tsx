"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createLiveBackend } from "./api";
import { createLocalBackend } from "./local/backend";
import { ApiException, type Backend, type User } from "./types";

const BackendContext = createContext<Backend | null>(null);

export function BackendProvider({ children }: { children: ReactNode }) {
  const backend = useMemo<Backend>(() => {
    const url = process.env.NEXT_PUBLIC_API_URL;
    return url ? createLiveBackend(url) : createLocalBackend();
  }, []);
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const b = useContext(BackendContext);
  if (!b) throw new Error("BackendProvider missing");
  return b;
}

/** Loads this browser's (anonymous) user. There is no login; `error` is set when the server cannot be reached. */
export function useCurrentUser(): { user: User | null; error: boolean; refresh: () => void } {
  const backend = useBackend();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    backend.me().then((u) => { if (alive) { setUser(u); setError(false); } }).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [backend, tick]);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  return { user, error, refresh };
}

export function errorText(e: unknown, locale: "ar" | "en"): string {
  if (e instanceof ApiException) return locale === "ar" ? e.messageAr : e.messageEn;
  return locale === "ar" ? "حدث خطأ. حاول مرة أخرى." : "Something went wrong. Try again.";
}

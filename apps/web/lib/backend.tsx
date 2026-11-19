"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createLiveBackend } from "./api";
import { createDemoBackend } from "./demo";
import { ApiException, type Backend, type User } from "./types";

const BackendContext = createContext<Backend | null>(null);

export function BackendProvider({ children }: { children: ReactNode }) {
  const backend = useMemo<Backend>(() => {
    const url = process.env.NEXT_PUBLIC_API_URL;
    return url ? createLiveBackend(url) : createDemoBackend();
  }, []);
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>;
}

export function useBackend(): Backend {
  const b = useContext(BackendContext);
  if (!b) throw new Error("BackendProvider missing");
  return b;
}

/** Loads the signed-in user; redirects to /login on 401. */
export function useRequireUser(): { user: User | null; refresh: () => void } {
  const backend = useBackend();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    backend.me().then((u) => alive && setUser(u)).catch((e) => {
      if (e instanceof ApiException && e.status === 401) router.replace("/login");
    });
    return () => { alive = false; };
  }, [backend, router, tick]);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  return { user, refresh };
}

export function errorText(e: unknown, locale: "ar" | "en"): string {
  if (e instanceof ApiException) return locale === "ar" ? e.messageAr : e.messageEn;
  return locale === "ar" ? "حدث خطأ. حاول مرة أخرى." : "Something went wrong. Try again.";
}

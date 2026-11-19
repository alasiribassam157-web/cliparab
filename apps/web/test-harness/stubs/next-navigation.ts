import { useEffect, useState } from "react";

/** Minimal stand-in for next/navigation, only used by the browser test harness (real app uses Next). */
const listeners = new Set<() => void>();
export function navigate(href: string, replace = false) {
  (replace ? history.replaceState : history.pushState).call(history, {}, "", href);
  listeners.forEach((l) => l());
}
function usePath(): string {
  const [p, setP] = useState(location.pathname);
  useEffect(() => {
    const on = () => setP(location.pathname);
    listeners.add(on);
    window.addEventListener("popstate", on);
    return () => { listeners.delete(on); window.removeEventListener("popstate", on); };
  }, []);
  return p;
}
export const usePathname = () => usePath();
const router = { push: (h: string) => navigate(h), replace: (h: string) => navigate(h, true), back: () => history.back() };
export const useRouter = () => router; // stable identity, like Next's
let params: Record<string, string> = {};
export const setParams = (p: Record<string, string>) => { params = p; };
export const useParams = <T,>() => params as unknown as T;

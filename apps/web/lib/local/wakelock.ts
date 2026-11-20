/** Keep the screen on while the browser works (phones lock the screen and suspend the page otherwise). */
interface Sentinel { release(): Promise<void>; released?: boolean }
let sentinel: Sentinel | null = null;
let holders = 0;

async function request() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<Sentinel> } }).wakeLock;
    if (wl && document.visibilityState === "visible") sentinel = await wl.request("screen");
  } catch { /* not supported or refused: the page note already asks the user to keep it open */ }
}
// the lock is dropped whenever the page is hidden; take it again when the user comes back
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (holders > 0 && document.visibilityState === "visible" && (!sentinel || sentinel.released)) void request(); });
}

export async function holdScreen(): Promise<() => void> {
  holders++;
  if (!sentinel || sentinel.released) await request();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0 && sentinel) { void sentinel.release().catch(() => undefined); sentinel = null; }
  };
}

/** User brand colours: two colours (a → b) used for the site accent, the opening-title banner and caption highlight of new clips. */
export interface Brand { a: string; b: string }
export const DEFAULT_BRAND: Brand = { a: "#22d3ee", b: "#a3e635" };
export const BRAND_PRESETS: { ar: string; en: string; v: Brand }[] = [
  { ar: "نيون (الافتراضي)", en: "Neon (default)", v: { a: "#22d3ee", b: "#a3e635" } },
  { ar: "أورورا", en: "Aurora", v: { a: "#8b5cf6", b: "#ff4d8d" } },
  { ar: "غروب", en: "Sunset", v: { a: "#ff7a3d", b: "#ffd21f" } },
  { ar: "محيط", en: "Ocean", v: { a: "#3b82f6", b: "#22d3ee" } },
  { ar: "زمرد", en: "Emerald", v: { a: "#10b981", b: "#a3e635" } },
  { ar: "وردي", en: "Rose", v: { a: "#f43f5e", b: "#fb923c" } },
  { ar: "ذهبي", en: "Gold", v: { a: "#e8b84a", b: "#b8742e" } },
  { ar: "أبيض وأسود", en: "Mono", v: { a: "#f4f4f5", b: "#a1a1aa" } },
];
const KEY = "cliparab.brand";
const HEX = /^#[0-9a-f]{6}$/i;

export function readBrand(): Brand {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (j && HEX.test(j.a) && HEX.test(j.b)) return { a: j.a, b: j.b };
  } catch { /* ignore */ }
  return DEFAULT_BRAND;
}
export function saveBrand(b: Brand) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ }
  applyBrand(b);
}
/** Readable text colour on top of a colour (dark ink on light colours, white on dark ones). */
export function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, bl = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * bl > 150 ? "#031014" : "#ffffff";
}
export function applyBrand(b: Brand = readBrand()) {
  const s = document.documentElement.style;
  const light = document.documentElement.getAttribute("data-theme") === "light";
  s.setProperty("--primary", b.a);
  s.setProperty("--accent", b.b);
  s.setProperty("--grad", `linear-gradient(120deg, ${b.a} 0%, ${b.b} 100%)`);
  s.setProperty("--primary-ink", inkFor(b.a));
  s.setProperty("--glow", `0 0 0 1px ${b.a}66, 0 10px 40px -8px ${b.a}88`);
  void light;
}
/** Inline script run before first paint so the saved colours do not flash. */
export const brandInit = `try{var b=JSON.parse(localStorage.getItem('${KEY}')||'null');if(b&&/^#[0-9a-f]{6}$/i.test(b.a)&&/^#[0-9a-f]{6}$/i.test(b.b)){var s=document.documentElement.style,n=parseInt(b.a.slice(1),16),l=.299*((n>>16)&255)+.587*((n>>8)&255)+.114*(n&255);s.setProperty('--primary',b.a);s.setProperty('--accent',b.b);s.setProperty('--grad','linear-gradient(120deg,'+b.a+' 0%,'+b.b+' 100%)');s.setProperty('--primary-ink',l>150?'#031014':'#ffffff')}}catch(e){}`;

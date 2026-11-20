"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import type { ScoreKey, Suggestion } from "@/lib/types";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="ClipArab">
      <span className="logo-mark" aria-hidden>▶</span>
      <span className="logo-word">ClipArab</span>
    </Link>
  );
}

function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<"light" | "dark" | "">("");
  useEffect(() => {
    try { setTheme((localStorage.getItem("cliparab.theme") as "light" | "dark") ?? ""); } catch { /* ignore */ }
  }, []);
  const toggle = () => {
    const dark = theme ? theme === "dark" : true;
    const next = dark ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("cliparab.theme", next); } catch { /* ignore */ }
  };
  return <button className="btn icon-btn" onClick={toggle} aria-label={t("theme")} title={t("theme")}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" /></svg>
    </button>;
}

function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <button className="btn sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label="Language">
      {locale === "ar" ? "EN" : "عربي"}
    </button>
  );
}

export function Shell({ children, authed = false }: { children: ReactNode; authed?: boolean }) {
  const { t } = useI18n();
  const backend = useBackend();
  const path = usePathname() ?? "";
  return (
    <>
      {backend.mode === "demo" && <div className="banner"><div className="container">{t("demo_banner")}</div></div>}
      {backend.mode === "local" && <div className="banner ok"><div className="container">{t("local_banner")}</div></div>}
      <header className={authed ? "topbar authed" : "topbar"}>
        <div className="container">
          <Logo />
          {authed && (
            <nav className="nav" aria-label="main">
              <Link href="/app" aria-current={path === "/app" ? "page" : undefined}>{t("nav_projects")}</Link>
              <Link href="/app/settings" aria-current={path.startsWith("/app/settings") ? "page" : undefined} aria-label={t("nav_settings")}><span className="nav-label">{t("nav_settings")}</span><span className="nav-icon" aria-hidden>⚙︎</span></Link>
            </nav>
          )}
          <span className="grow" />
          <LocaleToggle />
          <ThemeToggle />
          <Link className="btn primary sm" href={authed ? "/app/new" : "/app"}>{authed ? t("nav_new") : t("start_now")}</Link>
        </div>
      </header>
      <main className="container" style={{ paddingBlock: 28 }}>{children}</main>
    </>
  );
}

export function ScoreRing({ value, size = 76 }: { value: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 75 ? "var(--ok)" : value >= 55 ? "var(--accent)" : "var(--bad)";
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(value)}/100`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`} />
      </svg>
      <b>{Math.round(value)}</b>
    </div>
  );
}

const KEYS: ScoreKey[] = ["hook", "complete", "value", "audio", "visual", "engage"];

export function Breakdown({ s }: { s: Suggestion }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="bars">
        {KEYS.map((k) => (
          <div className="bar" key={k}>
            <span>{t("k_" + k)}</span>
            <div className="meter"><i style={{ width: `${Math.round((s.scores[k] ?? 0) * 100)}%` }} /></div>
            <span>{Math.round((s.scores[k] ?? 0) * 100)}</span>
          </div>
        ))}
      </div>
      {Object.keys(s.penalties).length > 0 && (
        <div className="pen">
          {Object.entries(s.penalties).map(([k, v]) => (
            <span className="chip bad" key={k}>−{v} {t("p_" + k)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(value * 100)}%` }} /></div>;
}

export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(id);
  }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}

export function statusChip(status: string, t: (k: string) => string) {
  const cls = status === "done" ? "ok" : status === "processing" ? "warn" : status === "error" ? "bad" : "";
  return <span className={`chip ${cls}`}>{t("status_" + status)}</span>;
}

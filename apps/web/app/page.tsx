"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShowcasePhone } from "@/components/ShowcasePhone";
import { Shell } from "@/components/ui";
import { useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { createSampleProject, loadShowcase, type Showcase } from "@/lib/local/backend";

function TypeLine({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(text.length); return; }
    let i = 0;
    const id = setInterval(() => { i += 2; setN(Math.min(text.length, i)); if (i >= text.length) clearInterval(id); }, 28);
    return () => clearInterval(id);
  }, [text]);
  return <p className="typeline" aria-label={text}><span aria-hidden>{text.slice(0, n)}</span><i className="caret" aria-hidden /></p>;
}

export default function Landing() {
  const { t } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const [sc, setSc] = useState<Showcase | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => { loadShowcase().then(setSc).catch(() => setSc(null)); }, []);
  const words = sc ? sc.transcript.segments.flatMap((s) => s.words) : [];
  const openSample = async () => {
    setOpening(true);
    try { router.push(`/app/p/${await createSampleProject(backend)}`); } catch { router.push("/app/new"); }
  };

  return (
    <Shell>
      <section className="hero">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="hero-title">
          {t("hero_lead").split(" ").map((w, i) => <span key={i}><span className="rv" style={{ "--i": i } as React.CSSProperties}>{w}</span>{" "}</span>)}
          <span className="rot" aria-label={t("hero_rot").split("|")[0]}>{t("hero_rot").split("|").map((w) => <span key={w}>{w}</span>)}</span>
        </h1>
        <TypeLine text={t("hero_sub")} />
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn primary" href="/app/new">{t("start_now")}</Link>
        </div>
        <div className="marquee" aria-hidden><div className="marquee-track">{[0, 1].flatMap((k) => ["TikTok", "Reels", "Shorts", "Snapchat", "9:16", "ترجمة عربية", "Karaoke", "ClipScore", "مجاني"].map((x) => <span key={`${k}${x}`}>{x}</span>))}</div></div>
        {sc && (
          <>
            <h2 style={{ marginTop: 36, marginBottom: 0, fontSize: "1.25rem" }}>{t("showcase_t")}</h2>
            <div className="showcase" data-testid="showcase">
              {sc.suggestions.slice(0, 3).map((s) => (
                <ShowcasePhone key={s.id} src={sc.source.preview_url} start={s.start} end={s.end} center={s.center ?? 0.5}
                  aspect={sc.source.width / sc.source.height} words={words} emphasis={s.emphasis} title={s.title} score={s.total} />
              ))}
            </div>
            {backend.mode === "local" && (
              <div className="row" style={{ justifyContent: "center", marginBottom: 6 }}>
                <button type="button" className="btn" onClick={openSample} disabled={opening}>{opening ? t("sample_loading") : t("showcase_open")}</button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="grid4" style={{ marginBottom: 56 }}>
        {[1, 2, 3, 4].map((i) => (
          <div className="card" key={i} data-reveal style={{ "--d": `${i * 90}ms` } as React.CSSProperties}>
            <div className="feat-ic" aria-hidden>{["✦", "✎", "◐", "⚡"][i - 1]}</div>
            <h3>{t(`f${i}_t`)}</h3>
          </div>
        ))}
      </section>

      <section>
        <h2>{t("how_t")}</h2>
        <div className="steps">
          {[1, 2, 3, 4].map((i) => <div className="card step" key={i} data-reveal style={{ "--d": `${i * 90}ms` } as React.CSSProperties}><b>{t(`s${i}`)}</b></div>)}
        </div>
      </section>
      <footer className="footer disclaimer">
        <p>{t("legal_note")}</p>
        {sc && <p><a href={sc.source.page} target="_blank" rel="noreferrer">{t("showcase_credit")}</a></p>}
      </footer>
    </Shell>
  );
}

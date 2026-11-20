"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShowcasePhone } from "@/components/ShowcasePhone";
import { Shell } from "@/components/ui";
import { useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { createSampleProject, loadShowcase, type Showcase } from "@/lib/local/backend";

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
        <h1>{t("hero_title")}</h1>
        <p>{t("hero_sub")}</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn primary" href="/app/new">{t("start_now")}</Link>
        </div>
        {sc && (
          <>
            <h2 style={{ marginTop: 36, marginBottom: 0, fontSize: "1.25rem" }}>{t("showcase_t")}</h2>
            <p className="small muted" style={{ margin: "4px 0 0" }}>{t("showcase_tap")}</p>
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
            <p className="small muted showcase-credit"><a href={sc.source.page} target="_blank" rel="noreferrer">{t("showcase_credit")}</a></p>
          </>
        )}
        <p className="small muted" style={{ marginTop: 0 }}>{t("local_landing")}</p>
      </section>

      <section className="grid4" style={{ marginBottom: 40 }}>
        {[1, 2, 3, 4].map((i) => (
          <div className="card" key={i}>
            <h3>{t(`f${i}_t`)}</h3>
            <p className="muted" style={{ margin: 0 }}>{t(`f${i}_d`)}</p>
          </div>
        ))}
      </section>

      <section>
        <h2>{t("how_t")}</h2>
        <div className="steps">
          {[1, 2, 3, 4].map((i) => <div className="card step" key={i}><b>{t(`s${i}`)}</b></div>)}
        </div>
      </section>
      <p className="footer">{t("legal_note")}</p>
    </Shell>
  );
}

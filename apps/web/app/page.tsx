"use client";

import Link from "next/link";
import { Shell } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function Landing() {
  const { t } = useI18n();

  return (
    <Shell>
      <section className="hero">
        <h1>{t("hero_title")}</h1>
        <p>{t("hero_sub")}</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn primary" href="/app/new">{t("start_now")}</Link>
        </div>
        <div className="demo-phones" aria-hidden>
          {["c01", "c02", "c03"].map((id) => (
            <video key={id} src={`/demo/${id}.mp4`} muted loop playsInline autoPlay preload="metadata" />
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>{t("demo_banner")}</p>
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

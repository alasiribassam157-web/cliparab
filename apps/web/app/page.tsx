"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/ui";
import { useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";

export default function Landing() {
  const { t } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const demo = backend.mode === "demo";

  const tryDemo = async () => {
    await backend.login("guest@cliparab.demo", "demo");
    router.push("/app");
  };

  return (
    <Shell>
      <section className="hero">
        <h1>{t("hero_title")}</h1>
        <p>{t("hero_sub")}</p>
        <div className="row" style={{ justifyContent: "center" }}>
          {demo ? <button className="btn primary" onClick={tryDemo}>{t("demo_try")}</button> : <Link className="btn primary" href="/register">{t("nav_register")}</Link>}
          <Link className="btn" href="/login">{t("nav_login")}</Link>
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

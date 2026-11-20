"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { useUser } from "@/lib/user";
import { BRAND_PRESETS, DEFAULT_BRAND, inkFor, readBrand, saveBrand, type Brand } from "@/lib/brand";

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const { user, refresh } = useUser();
  const [err, setErr] = useState("");
  const [toast, say] = useToast();
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  useEffect(() => setBrand(readBrand()), []);
  const pick = (b: Brand) => { setBrand(b); saveBrand(b); };
  if (!user) return null;

  const toggleTraining = async () => {
    await backend.updateMe({ allow_training: !user.allow_training });
    refresh();
    say(t("saved"));
  };
  const deleteAll = async () => {
    if (!window.confirm(t("confirm_delete"))) return;
    try {
      await backend.deleteMe();
      router.push("/");
    } catch (e) { setErr(errorText(e, locale)); }
  };

  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <h1>{t("settings_title")}</h1>
      <div className="card stack">
        <b>{t("no_account_title")}</b>
        <span className="muted small">{t("device_note")}</span>
      </div>
      <div className="card stack" data-testid="brand">
        <b>{t("brand_title")}</b>
        <span className="muted small">{t("brand_hint")}</span>
        <div className="brand-presets" role="group">
          {BRAND_PRESETS.map((p) => (
            <button key={p.en} type="button" className="brand-swatch" aria-pressed={p.v.a === brand.a && p.v.b === brand.b} onClick={() => pick(p.v)} title={locale === "ar" ? p.ar : p.en}
              style={{ background: `linear-gradient(120deg, ${p.v.a}, ${p.v.b})` }} aria-label={locale === "ar" ? p.ar : p.en} />
          ))}
        </div>
        <div className="row">
          <label className="row small">{t("brand_a")}<input type="color" value={brand.a} onChange={(e) => pick({ ...brand, a: e.target.value })} aria-label={t("brand_a")} /></label>
          <label className="row small">{t("brand_b")}<input type="color" value={brand.b} onChange={(e) => pick({ ...brand, b: e.target.value })} aria-label={t("brand_b")} /></label>
          <button type="button" className="btn sm" onClick={() => { pick(DEFAULT_BRAND); say(t("saved")); }}>{t("brand_reset")}</button>
        </div>
        <div className="brand-preview" style={{ background: `linear-gradient(120deg, ${brand.a}, ${brand.b})`, color: inkFor(brand.a) }}>{t("brand_sample")}</div>
      </div>
      <div className="card stack">
        <b>{t("language")}</b>
        <div className="seg" role="group">
          <button aria-pressed={locale === "ar"} onClick={() => setLocale("ar")}>العربية</button>
          <button aria-pressed={locale === "en"} onClick={() => setLocale("en")}>English</button>
        </div>
      </div>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>{t("privacy")}</h3>
        <label className="row">
          <input type="checkbox" checked={user.allow_training} onChange={toggleTraining} />
          <span><b>{t("train_consent")}</b><br /><span className="muted small">{t("train_hint")}</span></span>
        </label>
        <div className="small muted">{t("retention")}: 30 {t("days")}</div>
      </div>
      <div className="card stack" style={{ borderColor: "color-mix(in srgb, var(--bad) 40%, var(--border))" }}>
        <h3 style={{ margin: 0 }}>{t("danger")}</h3>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn danger" onClick={deleteAll}>{t("delete_account")}</button>
      </div>
      {toast}
    </div>
  );
}

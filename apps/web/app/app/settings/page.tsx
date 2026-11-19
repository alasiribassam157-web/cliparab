"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Progress, useToast } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { useUser } from "@/lib/user";

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const { user, refresh } = useUser();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [toast, say] = useToast();
  if (!user) return null;

  const toggleTraining = async () => {
    await backend.updateMe({ allow_training: !user.allow_training });
    refresh();
    say(t("saved"));
  };
  const deleteAccount = async () => {
    if (!window.confirm(t("confirm_delete"))) return;
    try {
      await backend.deleteMe(pw);
      router.push("/");
    } catch (e) { setErr(errorText(e, locale)); }
  };

  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <h1>{t("settings_title")}</h1>
      <div className="card stack">
        <div className="row spread"><b>{user.name || user.email}</b><span className="chip">{t("plan")}: {t("free")}</span></div>
        <span className="muted small" dir="ltr">{user.email}</span>
        <div className="small muted">{Math.round(user.minutes_remaining)} / {user.minutes_monthly} {t("minutes_left")} · {t("no_watermark")}</div>
        <Progress value={user.minutes_remaining / user.minutes_monthly} />
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
        {backend.mode === "live" && <input className="input" type="password" placeholder={t("confirm_password")} value={pw} onChange={(e) => setPw(e.target.value)} dir="ltr" />}
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn danger" onClick={deleteAccount}>{t("delete_account")}</button>
      </div>
      {toast}
    </div>
  );
}

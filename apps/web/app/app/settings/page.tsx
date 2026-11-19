"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { useUser } from "@/lib/user";

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const { user, refresh } = useUser();
  const [err, setErr] = useState("");
  const [toast, say] = useToast();
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

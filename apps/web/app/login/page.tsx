"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Shell } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";

export default function Login() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await backend.login(email, password);
      router.push("/app");
    } catch (ex) {
      setErr(errorText(ex, locale));
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="narrow">
        <form className="card stack" onSubmit={submit}>
          <h1>{t("login")}</h1>
          <label className="field">{t("email")}<input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></label>
          <label className="field">{t("password")}<input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" /></label>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy}>{t("login")}</button>
          <span className="muted small">{t("no_account")} <Link href="/register">{t("register")}</Link></span>
        </form>
      </div>
    </Shell>
  );
}

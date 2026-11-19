"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Shell } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";

export default function Register() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await backend.register(email, password, name);
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
          <h1>{t("register")}</h1>
          <label className="field">{t("name")}<input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="field">{t("email")}<input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="email" /></label>
          <label className="field">{t("password")}<input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="new-password" /></label>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy}>{t("register")}</button>
          <span className="muted small">{t("have_account")} <Link href="/login">{t("login")}</Link></span>
        </form>
      </div>
    </Shell>
  );
}

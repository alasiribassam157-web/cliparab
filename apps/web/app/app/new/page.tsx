"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Progress } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";

export default function NewProject() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [srt, setSrt] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frac, setFrac] = useState(0);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file && backend.mode === "live") return;
    setBusy(true);
    setErr("");
    try {
      const p = await backend.createProject(name || file?.name || "مشروع", "ar");
      await backend.uploadSource(p.id, file ?? new File([], "demo.mp4"), setFrac);
      if (srt) await backend.uploadSubtitles(p.id, await srt.text());
      await backend.analyze(p.id, 8);
      router.push(`/app/p/${p.id}`);
    } catch (ex) {
      setErr(errorText(ex, locale));
      setBusy(false);
    }
  };

  return (
    <form className="stack narrow" style={{ width: "min(640px, 100%)" }} onSubmit={submit}>
      <h1>{t("new_title")}</h1>
      <label className="field">{t("project_name")}<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <div className={`drop${over ? " over" : ""}`} role="button" tabIndex={0}
        onClick={() => fileRef.current?.click()} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <b>{file ? file.name : t("pick_video")}</b>
        <input ref={fileRef} type="file" accept="video/*,audio/*,.mkv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); } }} />
      </div>
      {backend.mode === "demo" && <p className="small muted" style={{ margin: 0 }}>{t("demo_upload_note")}</p>}
      <label className="field">{t("pick_srt")}<input className="input" type="file" accept=".srt,.vtt,text/vtt" onChange={(e) => setSrt(e.target.files?.[0] ?? null)} /></label>
      {busy && <div><div className="small muted">{t("uploading")}</div><Progress value={frac} /></div>}
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy || (!file && backend.mode === "live")}>{t("start_analysis")}</button>
    </form>
  );
}

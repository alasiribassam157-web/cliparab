"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Progress } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { sampleFile } from "@/lib/local/backend";
import { ApiException, type Backend, type Job } from "@/lib/types";

/** Resolves when the job finishes; rejects with the job's own (localised) error if it fails. */
function waitForJob(backend: Backend, jobId: string, onProgress: (f: number) => void): Promise<Job> {
  return new Promise((resolve, reject) => {
    const stop = backend.watchJob(jobId, (j) => {
      onProgress(j.progress);
      if (j.status === "done") { stop(); resolve(j); }
      else if (j.status === "error" || j.status === "canceled") {
        stop();
        reject(new ApiException(422, j.error?.code ?? "JOB_FAILED", j.error?.message_ar ?? "فشلت العملية.", j.error?.message_en ?? "The operation failed."));
      }
    });
  });
}

export default function NewProject() {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const [name, setName] = useState("");
  const [source, setSource] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
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

  const local = backend.mode === "local";
  const missing = (backend.mode === "live" && (source === "file" ? !file : !url.trim())) || (local && (source === "url" || !file));
  const [sampling, setSampling] = useState(false);
  const pickSample = async () => {
    setSampling(true); setErr("");
    try { const f = await sampleFile(); setFile(f); setSource("file"); if (!name) setName(locale === "ar" ? "حلقة نموذجية" : "Sample episode"); }
    catch (e) { setErr(errorText(e, locale)); }
    setSampling(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing) return;
    setBusy(true);
    setErr("");
    setFrac(0);
    let createdId: string | null = null;
    let hasSource = false;
    try {
      const fallback = source === "url" ? (locale === "ar" ? "فيديو من رابط" : "Video from link") : file?.name || "مشروع";
      const p = await backend.createProject(name.trim() || fallback, "ar");
      createdId = p.id;
      if (source === "url") {
        const job = await backend.importUrl(p.id, url.trim());
        await waitForJob(backend, job.id, setFrac);
      } else {
        await backend.uploadSource(p.id, file ?? new File([], "demo.mp4"), setFrac);
      }
      hasSource = true;
      if (srt) await backend.uploadSubtitles(p.id, await srt.text());
      await backend.analyze(p.id, 8);
      router.push(`/app/p/${p.id}`);
    } catch (ex) {
      // A failed upload/download must not leave an empty project in the list. (Once the source is in, keep it so the user can retry.)
      if (createdId && !hasSource) await backend.deleteProject(createdId).catch(() => undefined);
      setErr(errorText(ex, locale));
      setBusy(false);
    }
  };

  return (
    <form className="stack narrow" style={{ width: "min(640px, 100%)" }} onSubmit={submit}>
      <h1>{t("new_title")}</h1>
      <label className="field">{t("project_name")}<input className="input" value={name} onChange={(e) => setName(e.target.value)} required={source === "file"} /></label>
      <div className="seg" role="group" aria-label={t("pick_video")}>
        <button type="button" aria-pressed={source === "file"} onClick={() => setSource("file")} disabled={busy}>{t("src_file")}</button>
        <button type="button" aria-pressed={source === "url"} onClick={() => setSource("url")} disabled={busy}>{t("src_url")}</button>
      </div>
      {source === "file" ? (
        <div className={`drop${over ? " over" : ""}`} role="button" tabIndex={0}
          onClick={() => fileRef.current?.click()} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <b>{file ? file.name : t("pick_video")}</b>
          <input ref={fileRef} type="file" accept="video/*,audio/*,.mkv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); } }} />
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <label className="field">{t("video_url")}
            <input className="input" type="url" inputMode="url" dir="ltr" autoComplete="off" spellCheck={false}
              placeholder={t("video_url_ph")} value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <p className="small muted" style={{ margin: 0 }}>{t(local ? "url_local_note" : "url_hint")}</p>
        </div>
      )}
      {local && source === "file" && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn sm" onClick={pickSample} disabled={busy || sampling}>{sampling ? t("sample_loading") : t("try_sample")}</button>
          <span className="small muted">{t("long_video_note")}</span>
        </div>
      )}
      {backend.mode === "demo" && <p className="small muted" style={{ margin: 0 }}>{t(source === "url" ? "demo_url_note" : "demo_upload_note")}</p>}
      <label className="field">{t("pick_srt")}<input className="input" type="file" accept=".srt,.vtt,text/vtt" onChange={(e) => setSrt(e.target.files?.[0] ?? null)} /></label>
      {busy && <div><div className="small muted">{t(source === "url" ? "downloading" : "uploading")}</div><Progress value={frac} /></div>}
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy || missing}>{t("start_analysis")}</button>
    </form>
  );
}

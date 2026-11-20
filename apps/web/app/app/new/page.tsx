"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Progress } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { useI18n } from "@/lib/i18n";
import { createSampleProject } from "@/lib/local/backend";
import { isPhoneOrTablet } from "@/lib/local/asr";
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
  const [lang, setLang] = useState("ar");
  const [toAr, setToAr] = useState(true);
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
    if (f) { setFile(f); setName(f.name.replace(/\.[^.]+$/, "")); }
  };

  const local = backend.mode === "local";
  const missing = (backend.mode === "live" && (source === "file" ? !file : !url.trim())) || (local && (source === "url" || !file));
  const [sampling, setSampling] = useState(false);
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(isPhoneOrTablet()), []);
  const pickSample = async () => {
    setSampling(true); setErr("");
    try { const id = await createSampleProject(backend); router.push(`/app/p/${id}`); return; }
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
      const p = await backend.createProject(name.trim() || fallback, lang === "en" && toAr ? "en>ar" : lang);
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

  const pickFile = (f: File | undefined) => { if (f) { setFile(f); setName(f.name.replace(/\.[^.]+$/, "")); setErr(""); } };

  return (
    <form className="stack narrow simple-new" style={{ width: "min(560px, 100%)" }} onSubmit={submit}>
      <h1 style={{ marginBottom: 0 }}>{t("easy_title")}</h1>
      <p className="muted" style={{ margin: 0 }}>{t("easy_sub")}</p>

      {/* 1. the video */}
      <div className="easy-step"><span className="easy-num">1</span><b>{t("easy_s1")}</b></div>
      {source === "file" ? (
        <div className={`drop big-drop${over ? " over" : ""}${file ? " has-file" : ""}`} role="button" tabIndex={0}
          onClick={() => !busy && fileRef.current?.click()} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          {file ? (<><b className="file-name">🎬 {file.name}</b><span className="small muted">{t("easy_change")}</span></>)
            : (<><b>{t("easy_pick")}</b><span className="small muted">{t("easy_pick_sub")}</span></>)}
          <input ref={fileRef} type="file" accept="video/*,audio/*,.mkv" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
        </div>
      ) : (
        <label className="field">{t("video_url")}
          <input className="input" type="url" inputMode="url" dir="ltr" autoComplete="off" spellCheck={false} placeholder={t("video_url_ph")} value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
      )}
      {local && <p className="small muted" style={{ margin: 0 }} data-testid="upload-first">{t("upload_first")}</p>}

      {/* 2. language */}
      <div className="easy-step"><span className="easy-num">2</span><b>{t("easy_s2")}</b></div>
      <div className="seg big-seg" role="group" aria-label={t("lang_label")} data-testid="lang">
        <button type="button" aria-pressed={lang === "ar"} onClick={() => setLang("ar")} disabled={busy}>العربية</button>
        <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} disabled={busy}>English</button>
      </div>
      {lang === "en" && (
        <div className="seg" role="group" aria-label={t("cap_lang")} data-testid="cap-lang">
          <button type="button" aria-pressed={toAr} onClick={() => setToAr(true)} disabled={busy}>{t("cap_ar_tr")}</button>
          <button type="button" aria-pressed={!toAr} onClick={() => setToAr(false)} disabled={busy}>{t("easy_cap_en")}</button>
        </div>
      )}
      <span className="small muted">{lang === "en" && toAr ? t("tr_note") : t("lang_note")}</span>

      {/* 3. go */}
      {busy && <div><div className="small muted">{t(source === "url" ? "downloading" : "uploading")}</div><Progress value={frac} /></div>}
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary big-go" disabled={busy || missing}>{t("start_analysis")} ✨</button>
      {local && phone && <div className="note small" role="note" data-testid="phone-note">{t("phone_note")}</div>}

      {local && (
        <button type="button" className="link-btn" onClick={pickSample} disabled={busy || sampling}>{sampling ? t("sample_loading") : t("try_sample")}</button>
      )}
      {backend.mode === "demo" && <p className="small muted" style={{ margin: 0 }}>{t(source === "url" ? "demo_url_note" : "demo_upload_note")}</p>}

      <details className="more">
        <summary>{t("easy_more")}</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <label className="field">{t("project_name")}<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          {!local && (
            <div className="seg" role="group" aria-label={t("pick_video")}>
              <button type="button" aria-pressed={source === "file"} onClick={() => setSource("file")} disabled={busy}>{t("src_file")}</button>
              <button type="button" aria-pressed={source === "url"} onClick={() => setSource("url")} disabled={busy}>{t("src_url")}</button>
            </div>
          )}
          <label className="field">{t("pick_srt")}<input className="input" type="file" accept=".srt,.vtt,text/vtt" onChange={(e) => setSrt(e.target.files?.[0] ?? null)} /></label>
          {srt && <span className="small muted" data-testid="srt-name">✓ {srt.name}</span>}
          {local && <span className="small muted">{t("long_video_note")}</span>}
        </div>
      </details>
    </form>
  );
}

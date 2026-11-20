"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Breakdown, Progress, ScoreRing, statusChip } from "@/components/ui";
import { errorText, useBackend } from "@/lib/backend";
import { unlockAudio } from "@/lib/local/render";
import type { ExportItem } from "@/lib/types";
import { fmtDuration, fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Job, Project, Suggestion, Transcript } from "@/lib/types";
import { useUser } from "@/lib/user";

const STAGES = ["probe", "transcribe", "segment", "score", "translate", "preview"] as const;

function ClipCard({ s, pid, onEdit, busy, top }: { s: Suggestion; pid: string; onEdit: (s: Suggestion) => void; busy: boolean; top?: boolean }) {
  const { t, locale } = useI18n();
  const backend = useBackend();
  const [why, setWhy] = useState(false);
  const [dl, setDl] = useState<{ p: number; url?: string; name?: string; err?: string } | null>(null);
  const download = async () => {
    unlockAudio(); // must run inside the tap, before any await (iPhone)
    setDl({ p: 0 });
    try {
      const clip = await backend.createClip(pid, s.id);
      const r = await backend.exportClip(clip.id, "1080p");
      const stop = backend.watchJob(r.job.id, async (j) => {
        if (j.status === "error") { stop(); setDl({ p: 0, err: (locale === "ar" ? j.error?.message_ar : j.error?.message_en) || t("dl_fail") }); return; }
        if (j.status !== "done") { setDl({ p: j.progress }); return; }
        stop();
        const e = await backend.getExport(r.export.id);
        const url = backend.exportUrl(e, true);
        const name = `${(s.title || "clip").replace(/[\\/:*?"<>|…#·]/g, "").trim().slice(0, 60) || "clip"}.${(e as ExportItem & { mime?: string }).mime === "video/webm" ? "webm" : "mp4"}`;
        setDl({ p: 1, url, name });
        const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      });
    } catch (e) { setDl({ p: 0, err: errorText(e, locale) }); }
  };
  const [preview, setPreview] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  const vref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = vref.current;
    if (!preview || !v) return;
    const stop = () => { if (v.currentTime >= s.end) v.pause(); };
    v.addEventListener("timeupdate", stop);
    v.currentTime = s.start;
    void v.play().catch(() => {});
    return () => v.removeEventListener("timeupdate", stop);
  }, [preview, s.start, s.end]);

  return (
    <article className={`card clip-card${top ? " top-pick" : ""}`} data-testid="clip-card">
      {top && <span className="top-badge">★ {t("top_pick")}</span>}
      <div className="clip-thumb" aria-hidden={!thumbOk}>
        {thumbOk && backend.thumbUrl(pid, s.id) ? (
          <img src={backend.thumbUrl(pid, s.id)} alt={s.title} loading="lazy" onError={() => setThumbOk(false)} />
        ) : (
          <span className="clip-thumb-fallback">▶</span>
        )}
        <span className="clip-thumb-time" dir="ltr">{fmtDuration(s.duration)}</span>
        <span className="clip-thumb-score" aria-hidden>{Math.round(s.total)}</span>
      </div>
      <ScoreRing value={s.total} />
      <div>
        <div className="row spread" style={{ alignItems: "flex-start" }}>
          <h3 className="clip-title">#{s.rank} · {s.title}</h3>
          <span className="chip">{t("type_" + s.clip_type)}</span>
        </div>
        <div className="row small muted" style={{ marginBlock: 4 }}><span>{fmtDuration(s.duration)}</span></div>
        <div className="row">
          <button className="btn primary sm" onClick={download} disabled={busy || (!!dl && !dl.err && !dl.url)} data-testid="dl-btn">⬇ {t("dl_clip")}</button>
          <button className="btn sm" onClick={() => onEdit(s)} disabled={busy}>{t("edit")}</button>
          <button className="btn sm ghost-btn" onClick={() => setWhy((v) => !v)} aria-expanded={why} aria-label={t("why_clip")}>⋯</button>
        </div>
        {dl && (
          <div className="dl-box" data-testid="dl-box">
            {dl.err ? <div className="err" role="alert">{dl.err}</div>
              : dl.url ? <a className="btn sm" href={dl.url} download={dl.name} data-testid="dl-link">✓ {t("dl_ready")}</a>
              : <><span className="small muted">{t("dl_working")} {Math.round(dl.p * 100)}%</span><Progress value={dl.p} /></>}
          </div>
        )}
        {why && (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <p className="small muted" style={{ margin: 0 }}><span dir="ltr">{fmtTime(s.start)} – {fmtTime(s.end)}</span> · {s.reason_ar}</p>
            <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setPreview((v) => !v)}>{t("preview_source")}</button>
            <Breakdown s={s} />
          </div>
        )}
        {preview && <video ref={vref} className="clip-video" src={backend.mediaUrl(pid)} controls playsInline />}
      </div>
    </article>
  );
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const backend = useBackend();
  const router = useRouter();
  const { refresh } = useUser();
  const [project, setProject] = useState<Project | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [showText, setShowText] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [typeF, setTypeF] = useState("all");
  const [sort, setSort] = useState<"score" | "time">("score");

  // thumbnails that are drawn after the page opened (sample project) show up as they land
  useEffect(() => {
    const onThumbs = (e: Event) => { if ((e as CustomEvent).detail === id) void backend.suggestions(id).then((s) => setItems([...s])); };
    window.addEventListener("cliparab:thumbs", onThumbs);
    return () => window.removeEventListener("cliparab:thumbs", onThumbs);
  }, [backend, id]);

  // load project; follow the active job (or poll) while processing
  useEffect(() => {
    let alive = true;
    let stopWatch: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadDone = async (p: Project) => {
      const sug = await backend.suggestions(p.id);
      if (alive) { setItems(sug); setProject(p); }
    };
    const poll = async () => {
      try {
        const p = await backend.getProject(id);
        if (!alive) return;
        setProject(p);
        if (p.status === "done") { await loadDone(p); refresh(); return; }
        if (p.status === "processing") {
          if (p.active_job_id && !stopWatch) {
            stopWatch = backend.watchJob(p.active_job_id, (j) => { if (alive) setJob(j); });
          }
          timer = setTimeout(poll, 1500);
        }
      } catch (e) {
        if (alive) setErr(errorText(e, locale));
      }
    };
    void poll();
    return () => { alive = false; stopWatch?.(); if (timer) clearTimeout(timer); };
  }, [backend, id, locale, refresh]);

  const startAnalysis = async () => {
    setBusy(true);
    try {
      await backend.analyze(id, 8);
      setProject(await backend.getProject(id));
      window.location.reload();
    } catch (e) { setErr(errorText(e, locale)); setBusy(false); }
  };

  const edit = async (s: Suggestion) => {
    setBusy(true);
    try {
      const clip = await backend.createClip(id, s.id);
      router.push(`/app/c/${clip.id}`);
    } catch (e) { setErr(errorText(e, locale)); setBusy(false); }
  };

  const loadTranscript = async () => {
    setShowText((v) => !v);
    if (!transcript) setTranscript(await backend.transcript(id).catch(() => null));
  };

  const remove = async () => {
    if (!window.confirm(t("confirm_delete"))) return;
    await backend.deleteProject(id);
    router.push("/app");
  };

  if (!project) return <p className="muted">{err || t("loading")}</p>;

  const stageIdx = job ? Math.max(0, STAGES.indexOf((job.stage === "model" ? "transcribe" : job.stage) as (typeof STAGES)[number])) : 0;
  return (
    <div className="stack">
      <div className="row spread">
        <div>
          <h1 style={{ margin: 0 }}>{project.name}</h1>
          {["en", "ar", "en>ar"].includes(project.language) && <span className="chip" style={{ marginInlineStart: 8 }}>{project.language === "en>ar" ? "English ← ترجمة عربية" : project.language === "en" ? "English" : "العربية"}</span>}
          <span className="muted small">{project.source ? `${project.source.filename} · ${fmtDuration(project.source.duration)}` : ""}</span>
        </div>
        <div className="row">{statusChip(project.status, t)}<button className="btn danger sm" onClick={remove}>{t("delete_project")}</button></div>
      </div>
      {err && <div className="err" role="alert">{err}</div>}

      {project.status === "processing" && (
        <div className="card" data-testid="processing">
          <h2>{t("processing_title")}</h2>
          <Progress value={job?.progress ?? 0.05} />
          <div className="stages">
            {STAGES.filter((s) => s !== "translate" || project.language === "en>ar").map((s) => (
              <div key={s} className={`stage ${job && STAGES.indexOf(s) < stageIdx ? "done" : STAGES.indexOf(s) === stageIdx ? "active" : ""}`}><span className="dot" />{t("stage_" + s)}</div>
            ))}
          </div>
          {job?.stage === "model" && <p className="small" data-testid="model-stage">{t("stage_model")}</p>}
          <p className="muted small">{t(backend.mode === "local" ? "processing_hint_local" : "processing_hint")}</p>
        </div>
      )}

      {project.remote_url && <p className="small muted showcase-credit">{t("showcase_credit")}</p>}
      {project.status === "ready" && project.last_error && <div className="err" role="alert">{locale === "ar" ? project.last_error.ar : project.last_error.en}</div>}
      {project.status === "ready" && <div className="card"><button className="btn primary" onClick={startAnalysis} disabled={busy}>{t("start_analysis")}</button></div>}

      {project.status === "done" && (
        <>
          <div className="row spread">
            <h2 style={{ margin: 0 }}>{t("suggestions")} ({items.length})</h2>
            <button className="btn sm" onClick={loadTranscript}>{t("transcript")}</button>
          </div>
          {showText && transcript && (
            <div className="card small" style={{ maxHeight: 280, overflow: "auto" }}>
              {transcript.segments.map((s) => <div key={s.id}><span className="muted" dir="ltr">{fmtTime(s.start)}</span> {s.text}</div>)}
            </div>
          )}
          {items.length > 1 && (
            <div className="filterbar" role="group" aria-label={t("filter_all")}>
              <button type="button" className="chip preset" aria-pressed={typeF === "all"} onClick={() => setTypeF("all")}>{t("filter_all")} · {items.length}</button>
              {[...new Set(items.map((x) => x.clip_type))].map((k) => (
                <button key={k} type="button" className="chip preset" aria-pressed={typeF === k} onClick={() => setTypeF(k)}>{t("type_" + k)} · {items.filter((x) => x.clip_type === k).length}</button>
              ))}
              <span className="grow" />
              <button type="button" className="chip preset" onClick={() => setSort(sort === "score" ? "time" : "score")}>{sort === "score" ? t("sort_score") : t("sort_time")} ⇅</button>
            </div>
          )}
          <div className="stack">
            {items.filter((x) => typeF === "all" || x.clip_type === typeF).sort((a, b) => (sort === "score" ? b.total - a.total : a.start - b.start)).map((s) => <ClipCard key={s.id} s={s} pid={id} onEdit={edit} busy={busy} top={s.rank === 1} />)}
          </div>
        </>
      )}
    </div>
  );
}

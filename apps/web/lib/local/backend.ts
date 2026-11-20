/**
 * "Local" backend: the whole product runs in the visitor's browser — no server, no account, no cost.
 * Source videos, thumbnails, transcripts and exports live in IndexedDB; small records in localStorage.
 */
import { ApiException, type Backend, type Clip, type EditState, type ExportItem, type Job, type Project, type ReviewPage, type Suggestion, type Transcript, type User, type WordT } from "../types";
import { isPhoneOrTablet, transcribe } from "./asr";
import { AudioUnsupported, energyPeaks, openAudio, pickSpans, type AudioSource } from "./audio";
import { parseSubtitles, suggestClips, type Word } from "./engine";
import { idbClear, idbDel, idbDelPrefix, idbGet, idbPut } from "./idb";
import { renderClip } from "./render";
import { holdScreen } from "./wakelock";
import { isRtl, rtlShare, WHISPER_LANG } from "./dir";
import { bestFrame, closeVideo, openVideo, thumbnail, within } from "./vision";

const KEY = "cliparab.local.v1";
// Seconds of speech we transcribe at most; long videos get their most promising stretches only, so the wait
// stays reasonable on an ordinary laptop.
const TRANSCRIBE_BUDGET = 10 * 60;
// phones are several times slower and may be suspended: transcribe only the 3 most promising minutes
const PHONE_BUDGET = 3 * 60;

type LocalSuggestion = Suggestion & { center?: number };
interface State {
  user: User;
  projects: (Project & { last_error?: { ar: string; en: string } | null; remote_url?: string })[];
  clips: Clip[];
  exports: ExportItem[];
  jobs: Record<string, Job>;
  comments: Record<string, ReviewPage["comments"]>;
  links: Record<string, string>;
}

const guest = (): User => ({ id: "local-user", locale: "ar", allow_training: false });
const empty = (): State => ({ user: guest(), projects: [], clips: [], exports: [], jobs: {}, comments: {}, links: {} });
const uid = (p: string) => p + Math.random().toString(36).slice(2, 10);
const notFound = () => new ApiException(404, "NOT_FOUND", "العنصر المطلوب غير موجود.", "Resource not found.");

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const d = { ...empty(), ...JSON.parse(raw) } as State;
    d.user = { ...guest(), locale: d.user?.locale === "en" ? "en" : "ar", allow_training: !!d.user?.allow_training };
    return d;
  } catch { return empty(); }
}
function save(d: State) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked */ } }

class Fail extends Error { constructor(public code: string, public ar: string, public en: string) { super(code); } }

function probeVideo(file: Blob): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((ok, err) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = () => { const r = { duration: v.duration, width: v.videoWidth, height: v.videoHeight }; URL.revokeObjectURL(url); ok(r); };
    v.onerror = () => { URL.revokeObjectURL(url); err(new Error("unsupported")); };
    v.src = url;
  });
}

export function createLocalBackend(): Backend {
  const sources = new Map<string, Blob>();   // pid → source video (cached from IndexedDB)
  const urls = new Map<string, string>();    // cache key → object URL
  const running = new Map<string, Job>();    // live jobs of this page session

  const objUrl = (key: string, blob: Blob) => { let u = urls.get(key); if (!u) { u = URL.createObjectURL(blob); urls.set(key, u); } return u; };
  const projectOf = (d: State, id: string) => { const p = d.projects.find((x) => x.id === id); if (!p) throw notFound(); return p; };
  const clipOf = (d: State, id: string) => { const c = d.clips.find((x) => x.id === id); if (!c) throw notFound(); return c; };

  async function sourceOf(pid: string): Promise<Blob | null> {
    if (!sources.has(pid)) { const b = await idbGet<Blob>(`src:${pid}`).catch(() => undefined); if (b) sources.set(pid, b); }
    return sources.get(pid) ?? null;
  }

  function setJob(j: Job) {
    running.set(j.id, j);
    const d = load(); d.jobs[j.id] = j; save(d);
  }

  function startJob(kind: Job["kind"], pid: string, work: (report: (stage: string, f: number) => void) => Promise<Record<string, unknown> | null>): Job {
    const job: Job = { id: uid("lj_"), kind, status: "running", progress: 0, stage: kind === "export" ? "render" : "probe", project_id: pid, result: null, error: null };
    setJob(job);
    let last = 0;
    const report = (stage: string, f: number) => {
      const cur = running.get(job.id)!;
      const now = Date.now();
      running.set(job.id, { ...cur, stage, progress: Math.max(cur.progress, Math.min(0.999, f)) });
      if (now - last > 1500) { last = now; setJob(running.get(job.id)!); }
    };
    const release = holdScreen();
    work(report).finally(() => { void release.then((r) => r()); }).then((result) => {
      setJob({ ...running.get(job.id)!, status: "done", progress: 1, stage: "done", result });
    }).catch((e: unknown) => {
      const f = e instanceof Fail ? e : new Fail("JOB_FAILED", `فشلت المعالجة: ${e instanceof Error ? e.message : String(e)}`, `Processing failed: ${e instanceof Error ? e.message : String(e)}`);
      console.error("[cliparab]", e);
      setJob({ ...running.get(job.id)!, status: "error", error: { code: f.code, message_ar: f.ar, message_en: f.en } });
    });
    return job;
  }

  async function analyzeProject(pid: string, maxClips: number, report: (stage: string, f: number) => void) {
    const file = await sourceOf(pid);
    if (!file) throw new Fail("NO_SOURCE", "ملف الفيديو غير موجود في هذا المتصفح. ارفعه مرة أخرى.", "The video file is not stored in this browser. Upload it again.");
    const d0 = load();
    const p0 = projectOf(d0, pid);
    const duration = p0.source?.duration ?? 0;

    // 1) audio: level envelope of the whole video (also used to pick what to transcribe)
    report("probe", 0.01);
    let audio: AudioSource | null = null;
    let env: number[] = [];
    try {
      audio = await openAudio(file);
      env = await audio.envelopeDb((f) => report("probe", 0.02 + 0.13 * f));
      // safety net: if the fast MP4 reader produced nothing or silence, let the browser decode the file itself
      if ((!env.length || env.reduce((a, x) => Math.max(a, x), -200) < -70) && file.size < 450 * 1024 * 1024) {
        console.warn("[cliparab] fast audio reader returned silence; retrying with decodeAudioData");
        audio = await openAudio(file, true);
        env = await audio.envelopeDb();
      }
    } catch (e) {
      if (!(e instanceof AudioUnsupported)) console.warn("[cliparab] audio", e);
    }

    // 2) transcript: imported subtitles, or Whisper on the most promising stretches
    let segments: { start: number; end: number; text: string; words: Word[] }[] = [];
    let spans: Word[][] = [];
    let engine = "subtitle-import";
    const srt = await idbGet<string>(`srt:${pid}`).catch(() => undefined);
    if (srt) {
      segments = parseSubtitles(srt);
      spans = [segments.flatMap((s) => s.words)];
    } else {
      if (!audio) throw new Fail("AUDIO_UNSUPPORTED", "تعذّر قراءة صوت هذا الفيديو في المتصفح. جرّب ملف MP4 (H.264/AAC)، أو أرفق ملف ترجمة SRT.", "Could not read this video's audio in the browser. Try an MP4 (H.264/AAC) file, or attach an SRT subtitle file.");
      engine = "whisper-browser";
      const picks = pickSpans(env, audio.duration || duration, isPhoneOrTablet() ? PHONE_BUDGET : TRANSCRIBE_BUDGET);
      const total = picks.reduce((a, [s, e]) => a + (e - s), 0) || 1;
      let done = 0;
      // language: what the user chose, or auto-detected by the model; once the first stretch reads as Arabic, lock it for the rest
      let lang: string | undefined = WHISPER_LANG[p0.language] ?? (p0.language in WHISPER_LANG ? undefined : "arabic");
      for (const [s, e] of picks) {
        const pcm = await audio.pcm(s, e);
        let segs;
        try {
          segs = await transcribe(pcm, s, (stage, f) => report(stage === "model" ? "model" : "transcribe", stage === "model" ? 0.15 + 0.05 * f : 0.2 + 0.6 * ((done + f * (e - s)) / total)), lang);
        } catch (err) {
          throw new Fail("ASR_FAILED", `تعذّر تشغيل تفريغ الكلام في هذا المتصفح (${err instanceof Error ? err.message : err}). جرّب Chrome أو Edge حديث، أو أرفق ملف ترجمة SRT.`, `Speech recognition could not run in this browser (${err instanceof Error ? err.message : err}). Try a recent Chrome or Edge, or attach an SRT file.`);
        }
        done += e - s;
        if (lang === undefined && segs.length && rtlShare(segs.map((x) => x.text).join(" ")) > 0.7) lang = "arabic";
        segments.push(...segs);
        spans.push(segs.flatMap((x) => x.words));
        report("transcribe", 0.2 + 0.6 * (done / total));
      }
    }
    if (!segments.length) throw new Fail("NO_SPEECH", "لم نجد كلامًا واضحًا في هذا الفيديو، فلم نستطع اقتراح مقاطع.", "No clear speech was found in this video, so no clips could be suggested.");

    // 3) suggestions
    report("score", 0.82);
    let sug: LocalSuggestion[] = suggestClips({ spans, duration, maxClips, lang: isRtl(segments.map((x) => x.text).join(" ")) ? "ar" : "en", rmsDb: env.length ? env : null, peaks: energyPeaks(env) });
    if (!sug.length) throw new Fail("NO_CLIPS", "الكلام في الفيديو قصير جدًا لاقتراح مقاطع (نحتاج جملًا متصلة مدتها 15 ثانية على الأقل).", "The speech is too short to suggest clips (we need at least 15 s of connected sentences).");

    // 4) best frame + subject centre per clip, visual score, thumbnails
    report("preview", 0.88);
    let v: HTMLVideoElement | null = await openVideo(URL.createObjectURL(file)).catch(() => null);
    const frames: { t: number; cx: number; center: number; quality: number }[] = [];
    for (let i = 0; i < sug.length; i++) {
      const dflt = { t: (sug[i].start + sug[i].end) / 2, cx: 0.5, center: 0.5, quality: 0.6 };
      // a browser that cannot seek this file (some phones) must not hold the analysis hostage: after one stall, skip the frame work
      let fr = dflt;
      if (v) { try { fr = await within(bestFrame(v, sug[i].start, sug[i].end), 12000); } catch { if (!v.videoWidth || i === 0) { closeVideo(v); v = null; } } }
      frames.push(fr);
      report("preview", 0.88 + 0.06 * ((i + 1) / sug.length));
    }
    sug = sug.map((s, i) => ({ ...s, center: frames[i].center, scores: { ...s.scores, visual: Math.round(frames[i].quality * 1000) / 1000 },
      total: Math.round(Math.max(0, Math.min(100, s.total + 10 * (frames[i].quality - 0.6))) * 10) / 10, _f: frames[i] }))
      .sort((a, b) => b.total - a.total)
      .map((s, i) => ({ ...s, rank: i + 1, id: `c${String(i + 1).padStart(2, "0")}` }));
    await idbDelPrefix(`thumb:${pid}:`).catch(() => undefined);
    for (let i = 0; i < sug.length; i++) {
      const f = (sug[i] as LocalSuggestion & { _f: { t: number; cx: number } })._f;
      delete (sug[i] as Partial<LocalSuggestion & { _f: unknown }>)._f;
      if (v) {
        const blob = await within(thumbnail(v, f.t, f.cx), 8000).catch(() => null);
        if (blob) await idbPut(`thumb:${pid}:${sug[i].id}`, blob);
        else if (i === 0) { closeVideo(v); v = null; }
      }
      report("preview", 0.94 + 0.05 * ((i + 1) / sug.length));
    }
    if (v) closeVideo(v);
    for (const k of [...urls.keys()]) if (k.startsWith(`thumb:${pid}:`)) { URL.revokeObjectURL(urls.get(k)!); urls.delete(k); }

    const transcript: Transcript = { language: isRtl(segments.map((x) => x.text).join(" ")) ? "ar" : (p0.language !== "auto" && p0.language !== "ar" ? p0.language : "en"), engine, segments: segments.sort((a, b) => a.start - b.start).map((s, i) => ({ id: i, start: s.start, end: s.end, text: s.text, words: s.words })) };
    await idbPut(`sug:${pid}`, sug);
    await idbPut(`tr:${pid}`, transcript);
    const d = load(); const p = projectOf(d, pid);
    p.status = "done"; p.last_error = null; p.updated_at = new Date().toISOString(); p.active_job_id = null;
    save(d);
    return { clips: sug.length };
  }

  return {
    mode: "local",
    token: () => "local",
    async me() { return load().user; },
    async updateMe(patch) { const d = load(); d.user = { ...d.user, ...patch }; save(d); return d.user; },
    async deleteMe() { localStorage.removeItem(KEY); sources.clear(); await idbClear().catch(() => undefined); },
    async listProjects() {
      const d = load();
      // a page reload stops in-browser processing: surface that instead of an endless spinner
      let changed = false;
      for (const p of d.projects) if (p.status === "processing" && !(p.active_job_id && running.has(p.active_job_id))) {
        p.status = "ready";
        p.last_error = isPhoneOrTablet()
          ? { ar: "توقفت المعالجة: غالبًا خرجت من الصفحة أو أغلق الجوال المتصفح لأن ذاكرته امتلأت. جرّب مرة أخرى مع إبقاء الشاشة مفتوحة، أو استخدم كمبيوتر، أو أرفق ملف ترجمة SRT.", en: "Processing stopped: you probably left the page, or the phone closed the browser because it ran out of memory. Try again keeping the screen on, use a computer, or attach an SRT file." }
          : { ar: "توقفت المعالجة لأن الصفحة أُغلقت أو أُعيد تحميلها. اضغط «ابدأ التحليل» مرة أخرى.", en: "Processing stopped because the page was closed or reloaded. Start the analysis again." };
        changed = true;
      }
      if (changed) save(d);
      return [...d.projects].reverse();
    },
    async createProject(name, language) {
      const d = load();
      const now = new Date().toISOString();
      const p: Project = { id: uid("lp_"), name, language, status: "empty", created_at: now, updated_at: now, retention_days: 0, source: null };
      d.projects.push(p); save(d); return p;
    },
    async getProject(id) {
      await this.listProjects();
      const d = load();
      const p = projectOf(d, id);
      if (p.source) await sourceOf(id);
      if (p.status === "processing" && p.active_job_id) {
        const j = running.get(p.active_job_id);
        if (j?.status === "error") {
          p.status = "ready"; p.last_error = { ar: j.error?.message_ar ?? "", en: j.error?.message_en ?? "" }; p.active_job_id = null; save(d);
        }
      }
      return p;
    },
    async deleteProject(id) {
      const d = load();
      const clipIds = d.clips.filter((c) => c.project_id === id).map((c) => c.id);
      d.projects = d.projects.filter((p) => p.id !== id);
      d.clips = d.clips.filter((c) => c.project_id !== id);
      const gone = d.exports.filter((e) => clipIds.includes(e.clip_id));
      d.exports = d.exports.filter((e) => !clipIds.includes(e.clip_id));
      save(d);
      sources.delete(id);
      for (const k of [...urls.keys()]) if (k.includes(id)) { URL.revokeObjectURL(urls.get(k)!); urls.delete(k); }
      await Promise.all([idbDel(`src:${id}`), idbDel(`srt:${id}`), idbDel(`sug:${id}`), idbDel(`tr:${id}`), idbDelPrefix(`thumb:${id}:`), ...gone.map((e) => idbDel(`exp:${e.id}`))]).catch(() => undefined);
    },
    async uploadSource(pid, file, onProgress) {
      onProgress?.(0.1);
      const info = await probeVideo(file).catch(() => {
        throw new ApiException(415, "UNSUPPORTED_MEDIA", "المتصفح لا يستطيع تشغيل هذا الملف. جرّب فيديو MP4 (H.264).", "Your browser cannot play this file. Try an MP4 (H.264) video.");
      });
      if (!isFinite(info.duration) || info.duration <= 0) throw new ApiException(415, "UNSUPPORTED_MEDIA", "تعذّر قراءة مدة الفيديو.", "Could not read the video duration.");
      onProgress?.(0.4);
      sources.set(pid, file);
      // keep a copy for later visits in the background; a big file must not hold up the analysis
      void idbPut(`src:${pid}`, file).catch(() => {
        const d = load(); const p = d.projects.find((x) => x.id === pid);
        if (p) { p.last_error = { ar: "مساحة المتصفح لا تكفي لحفظ الفيديو؛ يعمل الآن، لكن ستحتاج رفعه مجددًا إذا أغلقت الصفحة.", en: "Not enough browser storage to keep the video; it works now but you will need to upload it again after closing the page." }; save(d); }
      });
      onProgress?.(1);
      const d = load(); const p = projectOf(d, pid);
      p.source = { filename: file.name || "video.mp4", duration: info.duration, width: info.width || 16, height: info.height || 9, size_bytes: file.size, has_subtitles: false };
      p.status = "ready";
      save(d);
      return p;
    },
    async importUrl() {
      throw new ApiException(422, "URL_NEEDS_SERVER", "استيراد الروابط (مثل يوتيوب) غير متاح في النسخة المجانية لأنه يحتاج خادمًا. نزّل الفيديو وارفعه هنا.", "Importing links (e.g. YouTube) is not available in the free version because it needs a server. Download the video and upload it here.");
    },
    async uploadSubtitles(pid, text) {
      try { if (!parseSubtitles(text).length) throw new Error("empty"); } catch {
        throw new ApiException(422, "BAD_SUBTITLES", "ملف الترجمة غير صالح (استخدم SRT أو VTT).", "Invalid subtitle file (use SRT or VTT).");
      }
      await idbPut(`srt:${pid}`, text);
      const d = load(); const p = projectOf(d, pid); if (p.source) p.source.has_subtitles = true; save(d);
    },
    async analyze(pid, maxClips) {
      const d = load(); const p = projectOf(d, pid);
      if (!p.source) throw new ApiException(409, "NO_SOURCE", "ارفع فيديو أولًا.", "Upload a source video first.");
      const job = startJob("analyze", pid, (report) => analyzeProject(pid, maxClips, report));
      const d2 = load(); const p2 = projectOf(d2, pid);
      p2.status = "processing"; p2.active_job_id = job.id; p2.last_error = null; save(d2);
      return job;
    },
    watchJob(jobId, cb) {
      let stop = false;
      const tick = () => {
        if (stop) return;
        const j = running.get(jobId) ?? load().jobs[jobId];
        if (!j) return;
        if (!running.has(jobId) && j.status === "running") {
          cb({ ...j, status: "error", error: { code: "INTERRUPTED", message_ar: "توقفت العملية لأن الصفحة أُعيد تحميلها.", message_en: "The page was reloaded, so the job stopped." } });
          return;
        }
        cb(j);
        if (j.status === "running" || j.status === "queued") setTimeout(tick, 300);
      };
      tick();
      return () => { stop = true; };
    },
    async suggestions(pid) {
      const sug = (await idbGet<LocalSuggestion[]>(`sug:${pid}`).catch(() => undefined)) ?? [];
      for (const s of sug) {
        const key = `thumb:${pid}:${s.id}`;
        if (!urls.has(key)) { const b = await idbGet<Blob>(key).catch(() => undefined); if (b) objUrl(key, b); }
      }
      return sug;
    },
    async transcript(pid) {
      return (await idbGet<Transcript>(`tr:${pid}`).catch(() => undefined)) ?? { language: "ar", engine: "none", segments: [] };
    },
    mediaUrl: (pid) => { const b = sources.get(pid); if (b) return objUrl(`src:${pid}`, b); return load().projects.find((p) => p.id === pid)?.remote_url ?? ""; },
    thumbUrl: (pid, sid) => urls.get(`thumb:${pid}:${sid}`) ?? "",
    async createClip(pid, suggestionId) {
      const sug = (await idbGet<LocalSuggestion[]>(`sug:${pid}`)) ?? [];
      const s = sug.find((x) => x.id === suggestionId);
      if (!s) throw notFound();
      const es: EditState = { start: s.start, end: s.end, layout: "fill", reframe_mode: "auto", manual_center: s.center ?? 0.5, auto_center: s.center ?? 0.5, captions: true,
        caption: { mode: "karaoke", position: "bottom", emphasis: s.emphasis }, words: null, resolution: "1080p", loudnorm: true, hook: true, hook_text: s.title.replace(/…$/, "") };
      const d = load(); projectOf(d, pid);
      const clip: Clip = { id: uid("lc_"), project_id: pid, suggestion_id: suggestionId, title: s.title, edit_state: es, version: 1 };
      d.clips.push(clip); save(d); return clip;
    },
    async getClip(id) { return clipOf(load(), id); },
    async patchClip(id, version, patch) {
      const d = load(); const c = clipOf(d, id);
      if (version !== c.version) throw new ApiException(409, "VERSION_CONFLICT", "تم تعديل هذا المقطع من مكان آخر.", "The clip was modified elsewhere.", { current_version: c.version });
      const es = { ...c.edit_state, ...patch.edit_state, caption: { ...c.edit_state.caption, ...(patch.edit_state?.caption ?? {}) } } as EditState;
      if (es.end - es.start < 1) throw new ApiException(422, "VALIDATION_ERROR", "البيانات المدخلة غير صالحة.", "clip shorter than 1 second");
      const dur = projectOf(d, c.project_id).source?.duration;
      if (dur && es.end > dur) es.end = dur;
      c.edit_state = es; c.version += 1; if (patch.title !== undefined) c.title = patch.title;
      save(d); return c;
    },
    async exportClip(cid, resolution) {
      const d = load(); const c = clipOf(d, cid);
      const remote = projectOf(d, c.project_id).remote_url;
      const file = remote ? null : await sourceOf(c.project_id);
      if (!file && !remote) throw new ApiException(409, "NO_SOURCE", "ملف الفيديو غير موجود في هذا المتصفح. ارفعه مرة أخرى.", "The video file is not stored in this browser. Upload it again.");
      const es = { ...c.edit_state, resolution };
      const tr = await this.transcript(c.project_id);
      const words: WordT[] = es.words ?? tr.segments.flatMap((s) => s.words).filter((w) => w.end > es.start && w.start < es.end);
      const e: ExportItem = { id: uid("le_"), clip_id: cid, status: "running", job_id: null, resolution, size_bytes: null, duration: es.end - es.start, download_url: null };
      const job = startJob("export", c.project_id, async (report) => {
        let r;
        try { r = await renderClip(remote ?? objUrl(`src:${c.project_id}`, file!), es, words, (f) => report("render", f)); }
        catch (err) {
          throw new Fail("EXPORT_FAILED", `تعذّر تصدير المقطع في هذا المتصفح (${err instanceof Error ? err.message : err}). جرّب Chrome أو Edge، وأبقِ الصفحة ظاهرة أثناء التصدير.`, `Export failed in this browser (${err instanceof Error ? err.message : err}). Try Chrome or Edge and keep the tab visible while exporting.`);
        }
        await idbPut(`exp:${e.id}`, r.blob).catch(() => undefined);
        const url = objUrl(`exp:${e.id}`, r.blob);
        const d2 = load(); const x = d2.exports.find((y) => y.id === e.id);
        if (x) { x.status = "done"; x.size_bytes = r.blob.size; x.download_url = url; x.duration = r.duration; (x as ExportItem & { mime?: string }).mime = r.mime; save(d2); }
        return { export_id: e.id };
      });
      e.job_id = job.id;
      const d3 = load(); d3.exports.push(e); save(d3);
      return { export: e, job };
    },
    async getExport(eid) {
      const e = load().exports.find((x) => x.id === eid);
      if (!e) throw notFound();
      if (e.status === "done") {
        const b = urls.has(`exp:${eid}`) ? null : await idbGet<Blob>(`exp:${eid}`).catch(() => undefined);
        if (b) objUrl(`exp:${eid}`, b);
        e.download_url = urls.get(`exp:${eid}`) ?? null;
      }
      return e;
    },
    exportUrl: (e) => urls.get(`exp:${e.id}`) ?? e.download_url ?? "",
    async createReviewLink(cid) {
      const d = load(); clipOf(d, cid); const token = uid("rv");
      d.links[token] = cid; save(d);
      return { token, path: `/review/${token}` };
    },
    async review(token) {
      const d = load(); const cid = d.links[token];
      if (!cid) throw notFound();
      const c = clipOf(d, cid);
      const last = [...d.exports].reverse().find((e) => e.clip_id === cid && e.status === "done");
      let video: string | null = null;
      if (last) { const b = await idbGet<Blob>(`exp:${last.id}`).catch(() => undefined); if (b) video = objUrl(`exp:${last.id}`, b); }
      return { title: c.title, has_video: !!video, allow_comments: true, video_url: video, comments: d.comments[cid] ?? [] };
    },
    reviewVideoUrl: () => "",
    async addComment(token, author, body, at) {
      const d = load(); const cid = d.links[token]; if (!cid) return;
      (d.comments[cid] ??= []).push({ id: uid("cm_"), author, body, at_seconds: at ?? null, created_at: new Date().toISOString() });
      save(d);
    },
  };
}

/** Real showcase: a CC-licensed Arabic interview hosted on Wikimedia Commons, analysed by this engine. */
export interface Showcase {
  source: { title: string; page: string; license: string; author: string; url: string; preview_url: string; duration: number; width: number; height: number };
  suggestions: (Suggestion & { center?: number })[];
  transcript: Transcript;
}
export async function loadShowcase(): Promise<Showcase> {
  const r = await fetch("/demo/showcase.json");
  if (!r.ok) throw new Error("showcase");
  return r.json();
}

/**
 * Opens the showcase as a ready project in this browser: real clips straight away, no upload, no model
 * download. The video streams from Wikimedia Commons; thumbnails are drawn from it on the spot.
 */
export async function createSampleProject(backend: Backend): Promise<string> {
  const sc = await loadShowcase();
  const p = await backend.createProject("مثال: مقابلة عربية حقيقية", "ar");
  const raw = localStorage.getItem(KEY);
  const d = raw ? (JSON.parse(raw) as State) : null;
  const proj = d?.projects.find((x) => x.id === p.id);
  if (!d || !proj) throw notFound();
  proj.source = { filename: sc.source.title, duration: sc.source.duration, width: sc.source.width, height: sc.source.height, size_bytes: 0, has_subtitles: false };
  proj.status = "done";
  proj.remote_url = sc.source.url;
  localStorage.setItem(KEY, JSON.stringify(d));
  await idbPut(`sug:${p.id}`, sc.suggestions);
  await idbPut(`tr:${p.id}`, sc.transcript);
  // open straight away; thumbnails are drawn in the background and the page is told as each one lands
  void (async () => {
    try {
      const v = await openVideo(sc.source.preview_url);
      for (const s of sc.suggestions) {
        const blob = await within(thumbnail(v, s.start + (s.end - s.start) * 0.4, s.center ?? 0.5), 8000).catch(() => null);
        if (blob) { await idbPut(`thumb:${p.id}:${s.id}`, blob); window.dispatchEvent(new CustomEvent("cliparab:thumbs", { detail: p.id })); }
      }
      closeVideo(v);
    } catch { /* thumbnails are optional */ }
  })();
  return p.id;
}

/**
 * The bundled sample episode, so visitors can try the full pipeline in one click. Its soundtrack is synthetic
 * (not real speech), so it ships with its subtitle file, which replaces speech recognition.
 */
export async function sampleFiles(): Promise<{ video: File; srt: File }> {
  const [v, s] = await Promise.all([fetch("/demo/source.mp4"), fetch("/demo/source.srt")]);
  return { video: new File([await v.blob()], "حلقة-نموذجية.mp4", { type: "video/mp4" }), srt: new File([await s.text()], "حلقة-نموذجية.srt", { type: "text/plain" }) };
}

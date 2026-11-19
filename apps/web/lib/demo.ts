import { ApiException, type Backend, type Clip, type EditState, type ExportItem, type Job, type Project, type ReviewPage, type Suggestion, type Transcript, type User } from "./types";

/**
 * Demo backend: runs entirely in the browser (localStorage) so the UI can be explored with no server.
 * Suggestions and transcript in /public/demo/demo.json are the real output of the ClipArab engine on a
 * sample episode, and /public/demo/<id>.mp4 are real renders of those suggestions.
 */
const KEY = "cliparab.demo.v1";
const ANALYZE_MS = 6000;
const EXPORT_MS = 3500;

interface DemoData {
  user: User | null;
  projects: Project[];
  clips: Clip[];
  exports: (ExportItem & { started: number; sid: string })[];
  jobs: Record<string, { id: string; kind: Job["kind"]; started: number; ms: number; project_id: string | null }>;
  comments: Record<string, ReviewPage["comments"]>;
  links: Record<string, string>;
  used: number;
}

interface DemoFile {
  duration: number;
  filename: string;
  width: number;
  height: number;
  transcript: Transcript;
  suggestions: Suggestion[];
}

let fileCache: Promise<DemoFile> | null = null;
const loadFile = () => (fileCache ??= fetch("/demo/demo.json").then((r) => r.json() as Promise<DemoFile>));

const empty = (): DemoData => ({ user: null, projects: [], clips: [], exports: [], jobs: {}, comments: {}, links: {}, used: 0 });
const uid = (p: string) => p + Math.random().toString(36).slice(2, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function load(): DemoData {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}
function save(d: DemoData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage full or blocked */ }
}

const mkUser = (email: string, name: string, used: number): User => ({
  id: "demo-user", email, name: name || "ضيف", locale: "ar", plan: "free", allow_training: false,
  minutes_remaining: Math.max(0, 120 - used), minutes_monthly: 120, watermark: false,
});

function jobView(d: DemoData, id: string): Job {
  const j = d.jobs[id];
  if (!j) throw new ApiException(404, "NOT_FOUND", "العنصر المطلوب غير موجود.", "Resource not found.");
  const frac = Math.min(1, (Date.now() - j.started) / j.ms);
  let stage = "done";
  if (j.kind === "analyze") stage = frac < 0.12 ? "probe" : frac < 0.5 ? "transcribe" : frac < 0.7 ? "segment" : frac < 0.92 ? "score" : frac < 1 ? "preview" : "done";
  else stage = frac < 1 ? "render" : "done";
  return { id, kind: j.kind, status: frac >= 1 ? "done" : "running", progress: frac, stage, project_id: j.project_id, result: null, error: null };
}

function settle(d: DemoData): void {
  // promote finished simulated jobs into their final state
  for (const p of d.projects) if (p.status === "processing") {
    const j = Object.values(d.jobs).find((x) => x.kind === "analyze" && x.project_id === p.id);
    if (j && Date.now() - j.started >= j.ms) p.status = "done";
  }
  for (const e of d.exports) if (e.status !== "done" && Date.now() - e.started >= EXPORT_MS) {
    e.status = "done";
    e.download_url = `/demo/${e.sid}.mp4`;
    e.size_bytes = 1_400_000;
  }
}

export function createDemoBackend(): Backend {
  const state = (): DemoData => { const d = load(); settle(d); return d; };
  const needUser = (d: DemoData) => {
    if (!d.user) throw new ApiException(401, "UNAUTHENTICATED", "يرجى تسجيل الدخول أولًا.", "Authentication required.");
    return d.user;
  };
  const projectOf = (d: DemoData, id: string) => {
    const p = d.projects.find((x) => x.id === id);
    if (!p) throw new ApiException(404, "NOT_FOUND", "العنصر المطلوب غير موجود.", "Resource not found.");
    return p;
  };
  const clipOf = (d: DemoData, id: string) => {
    const c = d.clips.find((x) => x.id === id);
    if (!c) throw new ApiException(404, "NOT_FOUND", "العنصر المطلوب غير موجود.", "Resource not found.");
    return c;
  };

  const signIn = async (email: string, name: string) => {
    const d = load();
    d.user = mkUser(email, name, d.used);
    save(d);
    return d.user;
  };

  return {
    mode: "demo",
    token: () => (load().user ? "demo" : null),
    register: (email, _pw, name) => signIn(email, name),
    login: (email) => signIn(email, "ضيف"),
    logout() { const d = load(); d.user = null; save(d); },
    async me() { const d = state(); const u = needUser(d); return { ...u, minutes_remaining: Math.max(0, 120 - d.used) }; },
    async updateMe(patch) { const d = state(); const u = needUser(d); d.user = { ...u, ...patch }; save(d); return d.user; },
    async deleteMe() { localStorage.removeItem(KEY); },
    async listProjects() { const d = state(); needUser(d); save(d); return [...d.projects].reverse(); },
    async createProject(name, language) {
      const d = state(); needUser(d);
      const now = new Date().toISOString();
      const p: Project = { id: uid("dp_"), name, language, status: "empty", created_at: now, updated_at: now, retention_days: 30, source: null };
      d.projects.push(p); save(d); return p;
    },
    async getProject(id) {
      const d = state(); needUser(d); save(d);
      const p = projectOf(d, id);
      const j = Object.values(d.jobs).find((x) => x.kind === "analyze" && x.project_id === id);
      return { ...p, active_job_id: p.status === "processing" && j ? j.id : null };
    },
    async deleteProject(id) {
      const d = state(); needUser(d);
      d.projects = d.projects.filter((p) => p.id !== id);
      d.clips = d.clips.filter((c) => c.project_id !== id);
      save(d);
    },
    async uploadSource(pid, _file, onProgress) {
      const d = state(); const p = projectOf(d, pid); const f = await loadFile();
      for (let i = 1; i <= 5; i++) { onProgress?.(i / 5); await sleep(120); }
      p.source = { filename: f.filename, duration: f.duration, width: f.width, height: f.height, size_bytes: 1_264_175, has_subtitles: false };
      p.status = "ready"; save(d); return p;
    },
    async uploadSubtitles(pid) { const d = state(); projectOf(d, pid).source!.has_subtitles = true; save(d); },
    async analyze(pid) {
      const d = state(); const p = projectOf(d, pid);
      if (!p.source) throw new ApiException(409, "NO_SOURCE", "ارفع فيديو أولًا.", "Upload a source video first.");
      const id = uid("dj_");
      d.jobs[id] = { id, kind: "analyze", started: Date.now(), ms: ANALYZE_MS, project_id: pid };
      d.used += Math.round((p.source.duration / 60) * 100) / 100;
      p.status = "processing"; save(d);
      return jobView(d, id);
    },
    watchJob(jobId, cb) {
      let stop = false;
      const tick = () => {
        if (stop) return;
        const d = state();
        let j: Job;
        try { j = jobView(d, jobId); } catch { return; }
        save(d);
        cb(j);
        if (j.status !== "done") setTimeout(tick, 250);
      };
      tick();
      return () => { stop = true; };
    },
    async suggestions(pid) { const d = state(); const p = projectOf(d, pid); return p.status === "done" ? (await loadFile()).suggestions : []; },
    async transcript() { return (await loadFile()).transcript; },
    mediaUrl: () => "/demo/source.mp4",
    async createClip(pid, suggestionId) {
      const d = state(); projectOf(d, pid);
      const s = (await loadFile()).suggestions.find((x) => x.id === suggestionId);
      if (!s) throw new ApiException(404, "NOT_FOUND", "العنصر المطلوب غير موجود.", "Resource not found.");
      const es: EditState = { start: s.start, end: s.end, layout: "fill", reframe_mode: "auto", manual_center: 0.5, captions: true,
        caption: { mode: "karaoke", position: "bottom", emphasis: s.emphasis }, words: null, resolution: "1080p", loudnorm: true };
      const clip: Clip = { id: uid("dc_"), project_id: pid, suggestion_id: suggestionId, title: s.title, edit_state: es, version: 1 };
      d.clips.push(clip); save(d); return clip;
    },
    async getClip(id) { const d = state(); return clipOf(d, id); },
    async patchClip(id, version, patch) {
      const d = state(); const c = clipOf(d, id); const f = await loadFile();
      if (version !== c.version) throw new ApiException(409, "VERSION_CONFLICT", "تم تعديل هذا المقطع من مكان آخر.", "The clip was modified elsewhere.", { current_version: c.version });
      const es = { ...c.edit_state, ...patch.edit_state, caption: { ...c.edit_state.caption, ...(patch.edit_state?.caption ?? {}) } } as EditState;
      if (es.end - es.start < 1) throw new ApiException(422, "VALIDATION_ERROR", "البيانات المدخلة غير صالحة.", "clip shorter than 1 second");
      if (es.end > f.duration) es.end = f.duration;
      c.edit_state = es; c.version += 1; if (patch.title !== undefined) c.title = patch.title;
      save(d); return c;
    },
    async exportClip(cid, resolution) {
      const d = state(); const c = clipOf(d, cid);
      const jid = uid("dj_");
      d.jobs[jid] = { id: jid, kind: "export", started: Date.now(), ms: EXPORT_MS, project_id: c.project_id };
      const e = { id: uid("de_"), clip_id: cid, status: "running" as const, job_id: jid, resolution, size_bytes: null, duration: c.edit_state.end - c.edit_state.start,
        download_url: null, started: Date.now(), sid: c.suggestion_id ?? "c01" };
      d.exports.push(e); save(d);
      return { export: e, job: jobView(d, jid) };
    },
    async getExport(eid) { const d = state(); const e = d.exports.find((x) => x.id === eid); if (!e) throw new ApiException(404, "NOT_FOUND", "غير موجود", "Not found"); save(d); return e; },
    exportUrl: (e) => e.download_url ?? "",
    async createReviewLink(cid) {
      const d = state(); clipOf(d, cid); const token = uid("rv");
      d.links[token] = cid; save(d);
      return { token, path: `/review/${token}` };
    },
    async review(token) {
      const d = state(); const cid = d.links[token];
      if (!cid) throw new ApiException(404, "NOT_FOUND", "العنصر المطلوب غير موجود.", "Resource not found.");
      const c = clipOf(d, cid);
      return { title: c.title, has_video: true, allow_comments: true, video_url: `/demo/${c.suggestion_id ?? "c01"}.mp4`, comments: d.comments[cid] ?? [] };
    },
    reviewVideoUrl: () => "",
    async addComment(token, author, body, at) {
      const d = state(); const cid = d.links[token]; if (!cid) return;
      (d.comments[cid] ??= []).push({ id: uid("cm_"), author, body, at_seconds: at ?? null, created_at: new Date().toISOString() });
      save(d);
    },
  };
}

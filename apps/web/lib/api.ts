import { ApiException, type Backend, type Clip, type EditState, type ExportItem, type Job, type Project, type ReviewPage, type Suggestion, type Transcript, type User } from "./types";

const TOKEN_KEY = "cliparab.token";

export function createLiveBackend(base: string): Backend {
  const root = base.replace(/\/$/, "");
  const getToken = () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  };
  const setToken = (t: string | null) => {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  };

  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: BodyInit): Promise<T> {
    const h: Record<string, string> = { ...headers };
    const tok = getToken();
    if (tok) h.Authorization = `Bearer ${tok}`;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(root + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    if (res.status === 204) return undefined as T;
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON error */ }
    if (!res.ok) {
      const e = data?.error;
      throw new ApiException(res.status, e?.code ?? "HTTP_" + res.status, e?.message_ar ?? "حدث خطأ", e?.message_en ?? "Error", e?.details);
    }
    return data as T;
  }

  const withToken = (url: string, download = false) => {
    const tok = getToken();
    const q = [tok ? `access_token=${encodeURIComponent(tok)}` : "", download ? "download=1" : ""].filter(Boolean).join("&");
    return root + url + (q ? (url.includes("?") ? "&" : "?") + q : "");
  };

  return {
    mode: "live",
    token: getToken,
    async register(email, password, name) {
      const r = await call<{ token: string; user: User }>("POST", "/v1/auth/register", { email, password, name });
      setToken(r.token);
      return r.user;
    },
    async login(email, password) {
      const r = await call<{ token: string; user: User }>("POST", "/v1/auth/login", { email, password });
      setToken(r.token);
      return r.user;
    },
    logout() { setToken(null); },
    me: () => call<User>("GET", "/v1/me"),
    updateMe: (patch) => call<User>("PATCH", "/v1/me", patch),
    deleteMe: async (password) => { await call<void>("DELETE", "/v1/me", { password }); setToken(null); },
    listProjects: async () => (await call<{ items: Project[] }>("GET", "/v1/projects")).items,
    createProject: (name, language) => call<Project>("POST", "/v1/projects", { name, language }),
    getProject: (id) => call<Project>("GET", `/v1/projects/${id}`),
    deleteProject: (id) => call<void>("DELETE", `/v1/projects/${id}`),
    uploadSource(pid, file, onProgress) {
      return new Promise<Project>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${root}/v1/projects/${pid}/source?filename=${encodeURIComponent(file.name)}`);
        const tok = getToken();
        if (tok) xhr.setRequestHeader("Authorization", `Bearer ${tok}`);
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onload = () => {
          let data: any = null;
          try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(data as Project);
          else reject(new ApiException(xhr.status, data?.error?.code ?? "HTTP_" + xhr.status, data?.error?.message_ar ?? "فشل الرفع", data?.error?.message_en ?? "Upload failed", data?.error?.details));
        };
        xhr.onerror = () => reject(new ApiException(0, "NETWORK", "تعذّر الاتصال بالخادم.", "Cannot reach the server."));
        xhr.send(file);
      });
    },
    importUrl: (pid, url) => call<Job>("POST", `/v1/projects/${pid}/source-url`, { url }),
    uploadSubtitles: async (pid, text) => { await call("PUT", `/v1/projects/${pid}/subtitles`, undefined, { "Content-Type": "text/plain; charset=utf-8" }, text); },
    analyze: (pid, maxClips) => call<Job>("POST", `/v1/projects/${pid}/analyze`, { max_clips: maxClips }, { "Idempotency-Key": `an-${pid}-${Date.now() >> 12}` }),
    watchJob(jobId, cb) {
      let stop = false;
      const tick = async () => {
        while (!stop) {
          try {
            const j = await call<Job>("GET", `/v1/jobs/${jobId}`);
            cb(j);
            if (["done", "error", "canceled"].includes(j.status)) return;
          } catch { /* transient: retry */ }
          await new Promise((r) => setTimeout(r, 1200));
        }
      };
      void tick();
      return () => { stop = true; };
    },
    suggestions: async (pid) => (await call<{ items: Suggestion[] }>("GET", `/v1/projects/${pid}/suggestions`)).items,
    transcript: (pid) => call<Transcript>("GET", `/v1/projects/${pid}/transcript`),
    mediaUrl: (pid) => withToken(`/v1/projects/${pid}/media`),
    createClip: (pid, suggestion_id) => call<Clip>("POST", `/v1/projects/${pid}/clips`, { suggestion_id }),
    getClip: (id) => call<Clip>("GET", `/v1/clips/${id}`),
    patchClip: (id, version, patch) => call<Clip>("PATCH", `/v1/clips/${id}`, patch, { "If-Match": String(version) }),
    exportClip: (cid, resolution) => call("POST", `/v1/clips/${cid}/exports`, { resolution }, { "Idempotency-Key": `ex-${cid}-${Date.now()}` }),
    getExport: (eid) => call<ExportItem>("GET", `/v1/exports/${eid}`),
    exportUrl: (e, download = false) => withToken(`/v1/exports/${e.id}/file`, download),
    createReviewLink: (cid) => call("POST", `/v1/clips/${cid}/review-links`, {}),
    review: (token) => call<ReviewPage>("GET", `/v1/review/${token}`),
    reviewVideoUrl: (token) => `${root}/v1/review/${token}/file`,
    addComment: async (token, author, body, at) => { await call("POST", `/v1/review/${token}/comments`, { author, body, at_seconds: at ?? null }); },
  };
}

export type { EditState };

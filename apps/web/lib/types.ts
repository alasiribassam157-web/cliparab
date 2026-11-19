export type Locale = "ar" | "en";

export interface User {
  id: string;
  email: string;
  name: string;
  locale: Locale;
  plan: string;
  allow_training: boolean;
  minutes_remaining: number;
  minutes_monthly: number;
  watermark: boolean;
}

export interface SourceInfo {
  filename: string;
  duration: number;
  width: number;
  height: number;
  size_bytes: number;
  has_subtitles: boolean;
}

export interface Project {
  id: string;
  name: string;
  language: string;
  status: "empty" | "ready" | "processing" | "done" | "error";
  created_at: string;
  updated_at: string;
  retention_days: number;
  source: SourceInfo | null;
  active_job_id?: string | null;
}

export interface JobError {
  code: string;
  message_ar: string;
  message_en: string;
}

export interface Job {
  id: string;
  kind: "analyze" | "export" | "import";
  status: "queued" | "running" | "done" | "error" | "canceled";
  progress: number;
  stage: string;
  project_id: string | null;
  result: Record<string, unknown> | null;
  error: JobError | null;
}

export type ScoreKey = "hook" | "complete" | "value" | "audio" | "visual" | "engage";

export interface Suggestion {
  id: string;
  rank: number;
  start: number;
  end: number;
  duration: number;
  total: number;
  clip_type: string;
  title: string;
  reason_ar: string;
  scores: Record<ScoreKey, number>;
  penalties: Record<string, number>;
  hooks: { type: string; text: string }[];
  emphasis: string[];
  text: string;
  engine: string;
  flags: string[];
}

export interface WordT {
  text: string;
  start: number;
  end: number;
  conf?: number;
  approx?: boolean;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: WordT[];
}

export interface Transcript {
  language: string;
  engine: string;
  segments: TranscriptSegment[];
}

export interface CaptionStyleT {
  mode: "karaoke" | "plain" | "pop";
  position: "bottom" | "middle" | "top";
  font_size: number;
  color: string;
  highlight: string;
  emphasis: string[];
  box: boolean;
}

export interface EditState {
  start: number;
  end: number;
  layout: "fill" | "fit" | "split";
  reframe_mode: "auto" | "center" | "manual";
  manual_center: number;
  captions: boolean;
  caption: Partial<CaptionStyleT>;
  words: WordT[] | null;
  resolution: "720p" | "1080p";
  loudnorm: boolean;
  [k: string]: unknown;
}

export interface Clip {
  id: string;
  project_id: string;
  suggestion_id: string | null;
  title: string;
  edit_state: EditState;
  version: number;
}

export interface ExportItem {
  id: string;
  clip_id: string;
  status: "queued" | "running" | "done" | "error" | "expired";
  job_id: string | null;
  resolution: string;
  size_bytes: number | null;
  duration: number | null;
  download_url: string | null;
}

export interface ReviewPage {
  title: string;
  has_video: boolean;
  allow_comments: boolean;
  video_url: string | null;
  comments: { id: string; author: string; body: string; at_seconds: number | null; created_at: string }[];
}

export class ApiException extends Error {
  constructor(public status: number, public code: string, public messageAr: string, public messageEn: string, public details?: unknown) {
    super(`${code}: ${messageEn}`);
  }
}

export interface Backend {
  mode: "demo" | "live";
  token(): string | null;
  register(email: string, password: string, name: string): Promise<User>;
  login(email: string, password: string): Promise<User>;
  logout(): void;
  me(): Promise<User>;
  updateMe(patch: Partial<Pick<User, "name" | "locale" | "allow_training">>): Promise<User>;
  deleteMe(password: string): Promise<void>;
  listProjects(): Promise<Project[]>;
  createProject(name: string, language: string): Promise<Project>;
  getProject(id: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  uploadSource(pid: string, file: File, onProgress?: (f: number) => void): Promise<Project>;
  /** Queue a download of the source video from a public link (YouTube etc.); resolves with the import job. */
  importUrl(pid: string, url: string): Promise<Job>;
  uploadSubtitles(pid: string, text: string): Promise<void>;
  analyze(pid: string, maxClips: number): Promise<Job>;
  watchJob(jobId: string, cb: (j: Job) => void): () => void;
  suggestions(pid: string): Promise<Suggestion[]>;
  transcript(pid: string): Promise<Transcript>;
  mediaUrl(pid: string): string;
  createClip(pid: string, suggestionId: string): Promise<Clip>;
  getClip(id: string): Promise<Clip>;
  patchClip(id: string, version: number, patch: { title?: string; edit_state?: Partial<EditState> }): Promise<Clip>;
  exportClip(cid: string, resolution: "720p" | "1080p"): Promise<{ export: ExportItem; job: Job }>;
  getExport(eid: string): Promise<ExportItem>;
  exportUrl(e: ExportItem, download?: boolean): string;
  createReviewLink(cid: string): Promise<{ token: string; path: string }>;
  review(token: string): Promise<ReviewPage>;
  reviewVideoUrl(token: string): string;
  addComment(token: string, author: string, body: string, at?: number): Promise<void>;
}

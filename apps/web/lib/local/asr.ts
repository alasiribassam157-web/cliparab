/**
 * Speech recognition in the browser: Whisper via transformers.js, loaded from a CDN inside a module
 * Web Worker (the page stays responsive). The model is downloaded once and cached by the browser.
 * whisper-small, 8-bit, on WASM (≈250 MB, one download). whisper-base was tried on a real browser and is not
 * usable for Arabic (garbled words, endless loops); WebGPU loading of whisper-small proved unreliable and needs
 * a ~600 MB download, so it is not used. The site is cross-origin isolated so WASM can use all CPU threads.
 */
import { interpolateWords, type Word } from "./engine";

const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

const WORKER_SRC = `
import { pipeline, env } from "${TRANSFORMERS}";
env.allowLocalModels = false;
let asr = null;
self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === "load") {
      if (e.data.single) { env.backends.onnx.wasm.numThreads = 1; env.backends.onnx.wasm.proxy = false; }
      else if (self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
      const opts = { device: e.data.device, progress_callback: (p) => self.postMessage({ id, type: "progress", p }) };
      opts.dtype = e.data.device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
      asr = await pipeline("automatic-speech-recognition", e.data.model, opts);
      self.postMessage({ id, type: "done" });
    } else if (type === "run") {
      const out = await asr(e.data.pcm, { language: e.data.language, task: "transcribe", chunk_length_s: 30, stride_length_s: 5, return_timestamps: true, no_repeat_ngram_size: 4 });
      self.postMessage({ id, type: "done", out });
    }
  } catch (err) {
    self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};`;

export interface AsrSegment { start: number; end: number; text: string; words: Word[] }
type Progress = (stage: "model" | "transcribe", f: number) => void;

/** Tests (and future engines) can replace recognition: window.__CLIPARAB_ASR__(pcm16k, offsetSeconds) → segments. */
type Override = (pcm: Float32Array, offset: number) => Promise<AsrSegment[]>;
declare global { interface Window { __CLIPARAB_ASR__?: Override } }

const HALLUCINATIONS = ["نانسي قنقر", "ترجمة نانسي", "اشتركوا في القناة", "شكرا للمشاهدة", "subtitles by", "amara.org"];

class WhisperWorker {
  private w: Worker;
  private seq = 0;
  private waiting = new Map<number, { ok: (v: unknown) => void; err: (e: Error) => void; progress?: (p: { status?: string; progress?: number; file?: string; loaded?: number; total?: number }) => void }>();
  constructor() {
    this.w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })), { type: "module" });
    this.w.onmessage = (e) => {
      const { id, type } = e.data;
      const h = this.waiting.get(id);
      if (!h) return;
      if (type === "progress") h.progress?.(e.data.p);
      else { this.waiting.delete(id); type === "done" ? h.ok(e.data.out) : h.err(new Error(e.data.message)); }
    };
    this.w.onerror = (e) => { for (const h of this.waiting.values()) h.err(new Error(e.message || "worker failed")); this.waiting.clear(); };
  }
  call<T>(msg: Record<string, unknown>, transfer: Transferable[] = [], progress?: (p: { status?: string; progress?: number; file?: string; loaded?: number; total?: number }) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, err) => { this.waiting.set(id, { ok: ok as (v: unknown) => void, err, progress }); this.w.postMessage({ id, ...msg }, transfer); });
  }
  terminate() { this.w.terminate(); }
}

/**
 * Phones and tablets: the 250 MB model and its working memory exceed what mobile browsers allow a tab (iOS kills
 * the page), and the work stops as soon as the user switches apps. We say so up front instead of failing silently.
 */
export function isPhoneOrTablet(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

let ready: Promise<WhisperWorker> | null = null;
let speed = 1; // seconds of work per second of audio, learned from the last piece
let device: "webgpu" | "wasm" | null = null;
/** Which engine the loaded model runs on (null until loaded). */
export const asrDevice = () => device;


async function load(onProgress: Progress): Promise<WhisperWorker> {
  const files = new Map<string, [number, number]>();
  const report = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, [p.loaded ?? 0, p.total ?? 0]);
    let a = 0, b = 0;
    files.forEach(([l, t]) => { a += l; b += t; });
    if (b) onProgress("model", a / b);
  };
  // A load that stops reporting for a long time is treated as failed (e.g. a WASM thread pool that never starts).
  const tryLoad = async (single: boolean) => {
    const w = new WhisperWorker();
    let last = Date.now();
    let timer = 0;
    const stalled = new Promise<never>((_, err) => {
      timer = window.setInterval(() => { if (Date.now() - last > 150_000) err(new Error("model load stalled")); }, 5000);
    });
    try {
      await Promise.race([w.call({ type: "load", device: "wasm", model: "onnx-community/whisper-small", single }, [], (p) => { last = Date.now(); report(p); }), stalled]);
      return w;
    } catch (e) { w.terminate(); throw e; } finally { clearInterval(timer); }
  };
  let w: WhisperWorker;
  try { w = await tryLoad(false); }
  catch (e) {
    console.warn("[cliparab] multi-threaded speech model failed, retrying single-threaded:", e);
    w = await tryLoad(true);
  }
  device = "wasm";
  return w;
}

function clean(chunks: { timestamp: [number, number | null]; text: string }[], offset: number, total: number): AsrSegment[] {
  const out: AsrSegment[] = [];
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text || HALLUCINATIONS.some((h) => text.toLowerCase().includes(h))) continue;
    if (/(.)\1{5,}/u.test(text)) continue; // "أأأأأأ…": decoder stuck on one token
    const toks = text.split(/\s+/);
    if (toks.length >= 6 && new Set(toks).size / toks.length < 0.35) continue; // "المنطقة المنطقة المنطقة…"
    if (out.length && out[out.length - 1].text === text) continue; // whisper loops on silence
    const start = offset + (c.timestamp[0] ?? 0);
    const end = offset + (c.timestamp[1] ?? Math.min(total, (c.timestamp[0] ?? 0) + 5));
    if (end <= start) continue;
    out.push({ start, end, text, words: interpolateWords(text, start, end, 0.85) });
  }
  return out;
}

/** Transcribe `pcm` (16 kHz mono) whose first sample is at `offset` seconds in the source. */
export async function transcribe(pcm: Float32Array, offset: number, onProgress: Progress, language?: string): Promise<AsrSegment[]> {
  if (typeof window !== "undefined" && window.__CLIPARAB_ASR__) return window.__CLIPARAB_ASR__(pcm, offset);
  ready ??= load(onProgress).catch((e) => { ready = null; throw e; });
  const w = await ready;
  const PIECE = 16000 * 90; // short pieces give regular progress updates
  const segs: AsrSegment[] = [];
  for (let i = 0; i < pcm.length; i += PIECE) {
    const piece = pcm.slice(i, i + PIECE);
    // the model reports nothing while it works on a piece: move the bar on an estimate so it never looks frozen
    const t0 = Date.now(), secs = piece.length / 16000;
    const beat = window.setInterval(() => onProgress("transcribe", Math.min(1, (i + PIECE * Math.min(0.95, (Date.now() - t0) / 1000 / (secs * speed))) / pcm.length)), 2000);
    let out: { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
    try { out = await w.call({ type: "run", pcm: piece, language }, [piece.buffer]); }
    finally { clearInterval(beat); }
    speed = Math.max(0.1, (Date.now() - t0) / 1000 / secs);
    segs.push(...clean(out.chunks ?? [{ timestamp: [0, piece.length / 16000], text: out.text }], offset + i / 16000, offset + pcm.length / 16000));
    onProgress("transcribe", Math.min(1, (i + PIECE) / pcm.length));
  }
  return segs;
}

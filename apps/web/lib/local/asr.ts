/**
 * Speech recognition in the browser: Whisper via transformers.js, loaded from a CDN inside a module
 * Web Worker (the page stays responsive). The model is downloaded once and cached by the browser.
 * WebGPU uses whisper-small (better Arabic); without WebGPU it falls back to whisper-base on WASM.
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
      const opts = { device: e.data.device, progress_callback: (p) => self.postMessage({ id, type: "progress", p }) };
      opts.dtype = e.data.device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
      asr = await pipeline("automatic-speech-recognition", e.data.model, opts);
      self.postMessage({ id, type: "done" });
    } else if (type === "run") {
      const out = await asr(e.data.pcm, { language: e.data.language, task: "transcribe", chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
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

let ready: Promise<WhisperWorker> | null = null;

async function load(onProgress: Progress): Promise<WhisperWorker> {
  const files = new Map<string, [number, number]>();
  const report = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, [p.loaded ?? 0, p.total ?? 0]);
    let a = 0, b = 0;
    files.forEach(([l, t]) => { a += l; b += t; });
    if (b) onProgress("model", a / b);
  };
  const tryDevice = async (device: "webgpu" | "wasm", model: string) => {
    const w = new WhisperWorker();
    try { await w.call({ type: "load", device, model }, [], report); return w; } catch (e) { w.terminate(); throw e; }
  };
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  if (gpu) {
    try { return await tryDevice("webgpu", "onnx-community/whisper-small"); } catch { /* fall back to WASM */ }
  }
  return tryDevice("wasm", "onnx-community/whisper-base");
}

function clean(chunks: { timestamp: [number, number | null]; text: string }[], offset: number, total: number): AsrSegment[] {
  const out: AsrSegment[] = [];
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text || HALLUCINATIONS.some((h) => text.toLowerCase().includes(h))) continue;
    if (out.length && out[out.length - 1].text === text) continue; // whisper loops on silence
    const start = offset + (c.timestamp[0] ?? 0);
    const end = offset + (c.timestamp[1] ?? Math.min(total, (c.timestamp[0] ?? 0) + 5));
    if (end <= start) continue;
    out.push({ start, end, text, words: interpolateWords(text, start, end, 0.85) });
  }
  return out;
}

/** Transcribe `pcm` (16 kHz mono) whose first sample is at `offset` seconds in the source. */
export async function transcribe(pcm: Float32Array, offset: number, onProgress: Progress, language = "arabic"): Promise<AsrSegment[]> {
  if (typeof window !== "undefined" && window.__CLIPARAB_ASR__) return window.__CLIPARAB_ASR__(pcm, offset);
  ready ??= load(onProgress).catch((e) => { ready = null; throw e; });
  const w = await ready;
  const PIECE = 16000 * 240; // 4-minute pieces give regular progress updates
  const segs: AsrSegment[] = [];
  for (let i = 0; i < pcm.length; i += PIECE) {
    const piece = pcm.slice(i, i + PIECE);
    const out = await w.call<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>({ type: "run", pcm: piece, language }, [piece.buffer]);
    segs.push(...clean(out.chunks ?? [{ timestamp: [0, piece.length / 16000], text: out.text }], offset + i / 16000, offset + pcm.length / 16000));
    onProgress("transcribe", Math.min(1, (i + PIECE) / pcm.length));
  }
  return segs;
}

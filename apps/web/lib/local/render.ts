/**
 * In-browser export: plays the clip once, draws every frame into a 9:16 canvas (fill / fit / split
 * layouts, Arabic captions with karaoke highlight) and records canvas + audio with MediaRecorder.
 * It runs in real time (a 30 s clip takes about 30 s) and needs the tab to stay visible.
 */
import { isRtl } from "./dir";
import { closeVideo, within } from "./vision";
import { inkFor } from "../brand";
import { captionAt, chunkWords } from "../captions";
import type { EditState, WordT } from "../types";
import { drawCover, openVideo, seek } from "./vision";

export interface RenderResult { blob: Blob; mime: string; duration: number }

export function pickMime(): string {
  const options = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

function captionFont(): string {
  try { return getComputedStyle(document.body).fontFamily || "sans-serif"; } catch { return "sans-serif"; }
}

function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, es: EditState, events: WordT[][], t: number, family: string) {
  const cap = es.caption;
  const maxChars = 22;
  const active = captionAt(events, t, cap.mode ?? "karaoke", cap.emphasis ?? [], maxChars);
  if (!active) return;
  const fs = ((cap.font_size ?? 74) / 1080) * W;
  const lh = fs * 1.25;
  ctx.font = `800 ${fs}px ${family}`;
  const rtl = isRtl(active.lines.flat().map((x) => x.w.text).join(" "));
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const pos = cap.position ?? "bottom";
  const block = active.lines.length * lh;
  let y = pos === "top" ? H * 0.12 + lh / 2 : pos === "middle" ? H / 2 - block / 2 + lh / 2 : H * (1 - 0.22) - block + lh / 2;
  const space = ctx.measureText(" ").width;
  for (const line of active.lines) {
    const widths = line.map((x) => ctx.measureText(x.w.text).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    if (cap.box) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(W / 2 - total / 2 - fs * 0.3, y - lh / 2, total + fs * 0.6, lh);
    }
    let xr = rtl ? W / 2 + total / 2 : W / 2 - total / 2; // first word: right-most in Arabic, left-most in English
    line.forEach((x, i) => {
      const color = (active.mode === "karaoke" && x.spoken) || x.emphasis ? cap.highlight ?? "#FFD21F" : cap.color ?? "#FFFFFF";
      ctx.lineWidth = fs * 0.14;
      ctx.strokeStyle = "#000";
      ctx.strokeText(x.w.text, xr, y);
      ctx.fillStyle = color;
      ctx.fillText(x.w.text, xr, y);
      xr += (rtl ? -1 : 1) * (widths[i] + space);
    });
    y += lh;
  }
}

/** Opening title banner (the hook): fades in over the first moments of the clip. */
function drawHook(ctx: CanvasRenderingContext2D, W: number, H: number, es: EditState, t: number, family: string) {
  const text = String(es.hook_text ?? "").replace(/…$/, "").trim();
  const el = t - es.start, D = 2.8;
  if (es.hook === false || !text || el < 0 || el > D) return;
  const a = Math.max(0, Math.min(1, el / 0.25, (D - el) / 0.35));
  const fs = W * 0.062, lh = fs * 1.3, maxW = W * 0.84;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `800 ${fs}px ${family}`;
  const rtl = isRtl(text);
  ctx.direction = rtl ? "rtl" : "ltr"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const lines: string[] = []; let cur = "";
  for (const w of text.split(/\s+/)) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(tryLine).width > maxW && lines.length < 2) { lines.push(cur); cur = w; } else cur = tryLine;
  }
  if (cur) lines.push(cur);
  const bw = Math.min(maxW + fs, Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs * 1.2), bh = lines.length * lh + fs * 0.7;
  const x = (W - bw) / 2, y = H * 0.08 + (1 - a) * -H * 0.02;
  const g = ctx.createLinearGradient(x, y, x + bw, y + bh);
  const c1 = String(es.hook_c1 ?? "#22d3ee"), c2 = String(es.hook_c2 ?? "#e879f9");
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, bw, bh, fs * 0.28); else ctx.rect(x, y, bw, bh);
  ctx.fill();
  ctx.fillStyle = inkFor(c1);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + fs * 0.35 + lh * (i + 0.5)));
  ctx.restore();
}

function drawFrame(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, W: number, H: number, es: EditState) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const auto = typeof es.auto_center === "number" ? (es.auto_center as number) : 0.5;
  const cx = es.reframe_mode === "manual" ? es.manual_center : es.reframe_mode === "center" ? 0.5 : auto;
  if (es.layout === "fit") {
    ctx.save();
    ctx.filter = `blur(${Math.round(W / 30)}px) brightness(0.6)`;
    drawCover(ctx, v, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1, 0.5);
    ctx.restore();
    const h = (W * v.videoHeight) / Math.max(1, v.videoWidth);
    ctx.drawImage(v, 0, (H - h) / 2, W, h);
  } else if (es.layout === "split") {
    const centers = (es.split_centers as [number, number] | null) ?? [0.25, 0.75];
    drawCover(ctx, v, 0, 0, W, H / 2, centers[0]);
    drawCover(ctx, v, 0, H / 2, W, H / 2, centers[1]);
  } else {
    drawCover(ctx, v, 0, 0, W, H, cx);
  }
}

let sharedCtx: AudioContext | null = null;
/**
 * Call synchronously inside a tap/click handler, before any await: iOS Safari only lets an AudioContext run when
 * it is created or resumed during a user gesture. Later exports reuse this context.
 */
export function unlockAudio() {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return;
    sharedCtx ??= new C();
    void sharedCtx.resume().catch(() => undefined);
    const b = sharedCtx.createBuffer(1, 1, 22050), n = sharedCtx.createBufferSource(); // a silent blip finishes the unlock on old iOS
    n.buffer = b; n.connect(sharedCtx.destination); n.start(0);
  } catch { /* ignore */ }
}

/** Safari (iPhone/iPad/Mac): media-element audio needs a fresh gesture, so decode the audio track instead. */
function preferDecodedAudio(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Safari\//.test(ua) && !/Chrome|Chromium|Android|Edg\//.test(ua));
}

const decoded = new Map<Blob, Promise<AudioBuffer>>();

/**
 * Renders the clip in real time: canvas frames + audio into MediaRecorder. `audioFile` (the source file, when it is
 * local) allows a decoded-audio path that needs no gesture: used first on Safari, and as the fallback anywhere the
 * video element refuses to play with sound or stops advancing.
 */
export async function renderClip(src: string, es: EditState, words: WordT[], onProgress: (f: number) => void, audioFile?: Blob | null): Promise<RenderResult> {
  const canDecode = !!audioFile && audioFile.size < 450 * 1024 * 1024;
  if (canDecode && preferDecodedAudio()) return renderOnce(src, es, words, onProgress, audioFile!);
  try { return await renderOnce(src, es, words, onProgress, null); }
  catch (err) {
    if (!canDecode) throw err;
    console.warn("[vyra] export with element audio failed, retrying with decoded audio:", err);
    return renderOnce(src, es, words, onProgress, audioFile!);
  }
}

async function renderOnce(src: string, es: EditState, words: WordT[], onProgress: (f: number) => void, audioFile: Blob | null): Promise<RenderResult> {
  const mime = pickMime();
  if (!mime || typeof HTMLCanvasElement.prototype.captureStream !== "function") throw new Error("recorder-unsupported");
  const W = es.resolution === "720p" ? 720 : 1080, H = Math.round((W * 16) / 9);
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  sharedCtx ??= new C();
  const actx = sharedCtx;
  await within(actx.resume(), 3000).catch(() => undefined);
  if (actx.state !== "running") throw new Error("audio-locked");
  let buf: AudioBuffer | null = null;
  if (audioFile) {
    let pr = decoded.get(audioFile);
    if (!pr) { pr = audioFile.arrayBuffer().then((ab) => actx.decodeAudioData(ab)); decoded.set(audioFile, pr); pr.catch(() => decoded.delete(audioFile)); }
    buf = await within(pr, 60000);
  }
  const v = await openVideo(src);
  v.muted = !!buf; v.volume = 1;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const family = captionFont();
  const events = es.captions ? chunkWords(words, 22) : [];

  const dest = actx.createMediaStreamDestination();
  let bufNode: AudioBufferSourceNode | null = null;
  let elNode: MediaElementAudioSourceNode | null = null;
  let srcNode: AudioNode;
  if (buf) { bufNode = actx.createBufferSource(); bufNode.buffer = buf; srcNode = bufNode; }
  else { elNode = actx.createMediaElementSource(v); srcNode = elNode; } // not connected to the speakers: export is silent for the user
  // speech levelling (≈ the server's loudnorm): an automatic gain steers the level toward −18 dBFS RMS while the
  // clip plays (quiet recordings are lifted, loud ones brought down), and a limiter keeps peaks from clipping
  const mkAgc = (analyser: AnalyserNode, gain: GainNode) => ({ analyser, gain, buf: new Float32Array(analyser.fftSize) });
  let agc: ReturnType<typeof mkAgc> | null = null;
  const nodes: AudioNode[] = [srcNode];
  if (es.loudnorm !== false) {
    const analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    const gain = actx.createGain();
    const limiter = actx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.12;
    srcNode.connect(analyser);
    srcNode.connect(gain).connect(limiter).connect(dest);
    agc = mkAgc(analyser, gain);
    nodes.push(analyser, gain, limiter);
  } else {
    srcNode.connect(dest);
  }
  let level = 0;

  await within(seek(v, es.start), 10000);
  drawFrame(ctx, v, W, H, es);
  const stream = canvas.captureStream(30);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W >= 1080 ? 8_000_000 : 5_000_000, audioBitsPerSecond: 160_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise<void>((ok) => { rec.onstop = () => ok(); });

  const dur = es.end - es.start;
  let raf = 0, failure: Error | null = null;
  const cleanup = () => {
    try { bufNode?.stop(); } catch { /* not started */ }
    for (const n of nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    stream.getTracks().forEach((t) => t.stop());
  };
  const finish = (err?: Error) => { if (err && !failure) failure = err; if (rec.state !== "inactive") rec.stop(); v.pause(); cancelAnimationFrame(raf); };
  const tick = () => {
    if (agc) {
      agc.analyser.getFloatTimeDomainData(agc.buf);
      let s2 = 0;
      for (let i = 0; i < agc.buf.length; i++) s2 += agc.buf[i] * agc.buf[i];
      const rms = Math.sqrt(s2 / agc.buf.length);
      if (rms > 0.004) { // ignore pauses so silence is not pumped up
        level = level ? level * 0.92 + rms * 0.08 : rms;
        const want = Math.min(8, Math.max(0.25, 0.126 / level)); // 0.126 ≈ −18 dBFS
        agc.gain.gain.setTargetAtTime(want, actx.currentTime, 0.3);
      }
    }
    drawFrame(ctx, v, W, H, es);
    if (events.length) drawCaptions(ctx, W, H, es, events, v.currentTime, family);
    drawHook(ctx, W, H, es, v.currentTime, family);
    onProgress(Math.min(0.99, (v.currentTime - es.start) / dur));
    if (v.currentTime >= es.end || v.ended) { finish(); return; }
    raf = requestAnimationFrame(tick);
  };
  rec.start(1000);
  try { await within(v.play(), 8000); }
  catch (e) { finish(new Error(`play-blocked: ${e instanceof Error ? e.message : e}`)); await stopped; cleanup(); closeVideo(v); throw failure; }
  if (bufNode) bufNode.start(0, Math.max(0, v.currentTime), dur + 1);
  raf = requestAnimationFrame(tick);
  // safety nets: stop at the end time even if frame callbacks are throttled, and fail (instead of hanging) if the
  // video stops advancing for 12 s
  let lastT = v.currentTime, lastMove = Date.now();
  const guard = setInterval(() => {
    if (v.currentTime >= es.end || v.ended) { finish(); return; }
    if (v.currentTime > lastT + 0.01) { lastT = v.currentTime; lastMove = Date.now(); }
    else if (!document.hidden && Date.now() - lastMove > 12000) finish(new Error("stalled"));
    if (!document.hidden && v.paused && !failure && rec.state !== "inactive") v.play().catch(() => undefined);
  }, 250);
  await stopped;
  clearInterval(guard);
  cleanup();
  closeVideo(v);
  if (failure) throw failure;
  onProgress(1);
  return { blob: new Blob(parts, { type: mime.split(";")[0] }), mime: mime.split(";")[0], duration: dur };
}

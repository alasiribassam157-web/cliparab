/**
 * Frame analysis with a <video> element and a canvas: best-looking frame per clip (sharp, well exposed,
 * contrasty, a face when the browser can detect one) and where the subject is, for the 9:16 crop.
 */

interface FaceDetectorLike { detect(src: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]> }
declare global { interface Window { FaceDetector?: new (o?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike } }

/** Rejects if `p` takes longer than `ms` (iOS Safari can leave media promises pending forever). */
export function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((ok, err) => {
    const t = setTimeout(() => err(new Error("timeout")), ms);
    p.then((x) => { clearTimeout(t); ok(x); }, (e) => { clearTimeout(t); err(e); });
  });
}

export async function openVideo(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
  v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
  // iOS Safari does not load media for a detached element: keep it in the page, invisible
  v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
  document.body.appendChild(v);
  v.src = url;
  v.load();
  try {
    await within(new Promise<void>((ok, err) => {
      const ready = () => { if (v.readyState >= 2) ok(); };
      v.addEventListener("loadeddata", ready, { once: true });
      v.addEventListener("canplay", ready, { once: true });
      v.addEventListener("error", () => err(new Error("video-decode")), { once: true });
      // iOS only starts decoding after a play(): a muted inline play-then-pause is allowed
      setTimeout(() => { if (v.readyState < 2) v.play().then(() => v.pause()).catch(() => undefined); }, 1200);
      ready();
    }), 9000);
  } catch (e) { closeVideo(v); throw e; }
  return v;
}

/** Releases the element. `revoke` also frees its blob URL: only for URLs this element owns, never shared cached ones. */
export function closeVideo(v: HTMLVideoElement, revoke = false) {
  try { v.pause(); if (revoke) URL.revokeObjectURL(v.src); v.removeAttribute("src"); v.load(); v.remove(); } catch { /* ignore */ }
}

export function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((ok) => {
    const done = () => { clearTimeout(timer); ok(); };
    const timer = setTimeout(done, 4000);
    v.addEventListener("seeked", done, { once: true });
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.05));
  });
}

let faceDet: FaceDetectorLike | null | undefined;
function faces(): FaceDetectorLike | null {
  if (faceDet === undefined) {
    try { faceDet = window.FaceDetector ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }) : null; } catch { faceDet = null; }
  }
  return faceDet;
}

export interface FrameInfo { score: number; cx: number; face: boolean }

/** Score the frame currently shown by `v`; cx is the subject's horizontal centre in [0, 1]. */
export async function frameInfo(v: HTMLVideoElement): Promise<FrameInfo> {
  const W = 192, H = Math.max(1, Math.round((W * v.videoHeight) / Math.max(1, v.videoWidth)));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(v, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  let mean = 0;
  for (let i = 0; i < W * H; i++) { g[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]; mean += g[i]; }
  mean /= W * H;
  let varSum = 0, lap = 0, lapSq = 0, cnt = 0;
  const col = new Float32Array(W);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
    lap += l; lapSq += l * l; cnt++;
    col[x] += Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + W] - g[i - W]);
  }
  for (let i = 0; i < W * H; i++) varSum += (g[i] - mean) ** 2;
  const lapVar = lapSq / cnt - (lap / cnt) ** 2;
  const sharp = Math.min(lapVar / 300, 1);
  const exposure = Math.max(0, 1 - Math.abs(mean / 255 - 0.45) / 0.45);
  const contrast = Math.min(Math.sqrt(varSum / (W * H)) / 64, 1);

  // subject centre: a detected face wins; otherwise the centroid of edge energy (people and text are busy, backgrounds are flat)
  let cx = 0.5, face = false;
  const fd = faces();
  if (fd) {
    try {
      const f = await fd.detect(v);
      if (f.length) {
        const big = f.reduce((a, b) => (b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height ? b : a));
        cx = (big.boundingBox.x + big.boundingBox.width / 2) / v.videoWidth;
        face = true;
      }
    } catch { /* detector unavailable for this frame */ }
  }
  if (!face) {
    let tot = 0, acc = 0;
    for (let x = 0; x < W; x++) { const e = col[x] ** 2; tot += e; acc += e * x; }
    if (tot > 0) cx = 0.5 + 0.7 * (acc / tot / W - 0.5); // pulled toward the middle: edge energy is a weak cue
  }
  return { score: 0.9 * sharp + exposure + 0.6 * contrast + (face ? 0.8 : 0), cx: Math.max(0, Math.min(1, cx)), face };
}

/** Best moment in [start, end] (skips the first/last 10%, mild preference for the middle): its time and subject x, plus the clip's typical subject x (`center`) for the 9:16 crop. */
const MW = 96;
function grayRow(v: HTMLVideoElement): Float32Array {
  const H = Math.max(1, Math.round((MW * v.videoHeight) / Math.max(1, v.videoWidth)));
  const c = document.createElement("canvas");
  c.width = MW; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(v, 0, 0, MW, H);
  const px = ctx.getImageData(0, 0, MW, H).data;
  const g = new Float32Array(MW * H);
  for (let i = 0; i < MW * H; i++) g[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
  return g;
}

/**
 * Best moment in [start, end] (skips the first/last 10%, mild preference for the middle): its time and subject x,
 * plus the clip's subject x for the 9:16 crop (`center`). The speaker is found by where things move between frames
 * 0.4 s apart (a talking, gesturing person moves; the listener and background mostly do not); a detected face wins.
 */
export async function bestFrame(v: HTMLVideoElement, start: number, end: number, samples = 7): Promise<{ t: number; cx: number; center: number; quality: number }> {
  const span = Math.max(end - start, 0.1), mid = (start + end) / 2;
  let best = { t: mid, cx: 0.5, s: -1, q: 0 };
  const cxs: number[] = [];
  const faceXs: number[] = [];
  const motion = new Float32Array(MW);
  for (let i = 0; i < samples; i++) {
    const t = start + span * (0.1 + (0.8 * (i + 0.5)) / samples);
    await seek(v, t);
    const f = await frameInfo(v);
    const a = grayRow(v);
    await seek(v, Math.min(end, t + 0.4));
    const b = grayRow(v);
    const rows = a.length / MW;
    for (let y = 0; y < rows; y++) for (let x = 0; x < MW; x++) { const d = Math.abs(a[y * MW + x] - b[y * MW + x]); if (d > 12) motion[x] += d; }
    cxs.push(f.cx);
    if (f.face) faceXs.push(f.cx);
    const s = f.score - (0.15 * Math.abs(t - mid)) / (span / 2);
    if (s > best.s) best = { t, cx: f.cx, s, q: f.score };
  }
  const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  let center = median(cxs);
  // motion centroid, smoothed; only trusted when the movement is concentrated (not a camera pan or a cut)
  const sm = Array.from(motion, (_, x) => { let s = 0; for (let k = -4; k <= 4; k++) s += motion[Math.min(MW - 1, Math.max(0, x + k))]; return s; });
  const total = sm.reduce((p, q) => p + q, 0);
  if (total > 0) {
    let peak = 0;
    sm.forEach((m, x) => { if (m > sm[peak]) peak = x; });
    let w = 0, acc = 0;
    for (let x = Math.max(0, peak - 20); x <= Math.min(MW - 1, peak + 20); x++) { w += sm[x]; acc += sm[x] * x; }
    if (w / total > 0.45) center = (acc / w + 0.5) / MW;
  }
  if (faceXs.length >= Math.ceil(samples / 2)) center = median(faceXs);
  // thumbnail framing follows the same subject unless that frame has its own face
  const thumbCx = best.cx !== 0.5 && faceXs.length ? best.cx : center;
  return { t: best.t, cx: thumbCx, center: Math.max(0, Math.min(1, center)), quality: Math.min(1, best.q / 2.5) };
}

/** Vertical 9:16 JPEG of time `t`, cropped around `cx`. */
export async function thumbnail(v: HTMLVideoElement, t: number, cx: number, width = 540): Promise<Blob> {
  await seek(v, t);
  const h = Math.round((width * 16) / 9);
  const c = document.createElement("canvas");
  c.width = width; c.height = h;
  const ctx = c.getContext("2d")!;
  drawCover(ctx, v, 0, 0, width, h, cx);
  return new Promise((ok, err) => c.toBlob((b) => (b ? ok(b) : err(new Error("thumb"))), "image/jpeg", 0.85));
}

/** Draw `v` to fill the box, cropping horizontally around `cx` (or vertically centred when the source is taller). */
export function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number, cx: number) {
  const sw = v.videoWidth, sh = v.videoHeight;
  if (!sw || !sh) return;
  const boxAR = w / h, srcAR = sw / sh;
  if (srcAR > boxAR) {
    const cw = sh * boxAR;
    const sx = Math.max(0, Math.min(sw - cw, cx * sw - cw / 2));
    ctx.drawImage(v, sx, 0, cw, sh, x, y, w, h);
  } else {
    const ch = sw / boxAR;
    ctx.drawImage(v, 0, (sh - ch) / 2, sw, ch, x, y, w, h);
  }
}

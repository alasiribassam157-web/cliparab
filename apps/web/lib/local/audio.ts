/**
 * Audio access for in-browser analysis.
 *
 * MP4/MOV/M4A: a minimal demuxer reads the audio sample table and feeds AAC packets to WebCodecs'
 * AudioDecoder, so even multi-hour files are scanned in a few MB of memory and any time range can be
 * decoded on its own (we only transcribe the promising parts of long videos).
 * Other containers (WebM, MKV, MP3...) fall back to decodeAudioData, which needs the whole file in memory.
 */

export const SR = 16000; // Whisper's sample rate
export const WIN = 0.5; // seconds per RMS window

interface Track { timescale: number; sampleRate: number; channels: number; asc: Uint8Array; codec: string; sizes: Uint32Array; offsets: Float64Array; times: Float64Array; duration: number }
export interface AudioSource { duration: number; envelopeDb(onProgress?: (f: number) => void): Promise<number[]>; pcm(start: number, end: number): Promise<Float32Array> }

// ------------------------------------------------------------------------------------------ MP4 boxes
async function readBytes(file: Blob, pos: number, len: number): Promise<DataView> {
  return new DataView(await file.slice(pos, pos + len).arrayBuffer());
}
async function findTopBox(file: Blob, type: string): Promise<{ start: number; size: number } | null> {
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = await readBytes(file, pos, 16);
    let size = h.getUint32(0);
    const t = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    let header = 8;
    if (size === 1) { size = Number(h.getBigUint64(8)); header = 16; } else if (size === 0) size = file.size - pos;
    if (size < header) return null;
    if (t === type) return { start: pos, size };
    pos += size;
  }
  return null;
}
function children(v: DataView, start: number, end: number): Map<string, { s: number; e: number }[]> {
  const m = new Map<string, { s: number; e: number }[]>();
  let p = start;
  while (p + 8 <= end) {
    let size = v.getUint32(p);
    const t = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
    let h = 8;
    if (size === 1) { size = Number(v.getBigUint64(p + 8)); h = 16; } else if (size === 0) size = end - p;
    if (size < h || p + size > end) break;
    (m.get(t) ?? m.set(t, []).get(t)!).push({ s: p + h, e: p + size });
    p += size;
  }
  return m;
}
const first = (m: Map<string, { s: number; e: number }[]>, t: string) => m.get(t)?.[0];

function parseEsds(v: DataView, s: number, e: number): Uint8Array | null {
  // esds: version/flags(4) then descriptors; find DecoderSpecificInfo (tag 5)
  let p = s + 4;
  const readLen = () => { let len = 0; for (let i = 0; i < 4; i++) { const b = v.getUint8(p++); len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return len; };
  while (p < e) {
    const tag = v.getUint8(p++);
    const len = readLen();
    if (tag === 3) { p += 3; continue; } // ES_Descriptor: ES_ID(2) + flags(1); assume no optional fields
    if (tag === 4) { p += 13; continue; } // DecoderConfigDescriptor header
    if (tag === 5) return new Uint8Array(v.buffer, v.byteOffset + p, len).slice();
    p += len;
  }
  return null;
}

/** Collect one track's samples from every moof/traf/trun in a fragmented MP4. */
async function readFragments(file: Blob, trackId: number, trexDur: number, trexSize: number, timescale: number) {
  const sizes: number[] = [], offsets: number[] = [], times: number[] = [];
  let pos = 0, t = 0;
  while (pos + 8 <= file.size) {
    const h = await readBytes(file, pos, 16);
    let size = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (size === 1) size = Number(h.getBigUint64(8)); else if (size === 0) size = file.size - pos;
    if (size < 8) break;
    if (type === "moof" && size < 64 * 1024 * 1024) {
      const m = await readBytes(file, pos, size);
      for (const traf of children(m, 8, m.byteLength).get("traf") ?? []) {
        const tc = children(m, traf.s, traf.e);
        const tfhd = first(tc, "tfhd");
        if (!tfhd || m.getUint32(tfhd.s + 4) !== trackId) continue;
        const tf = m.getUint32(tfhd.s) & 0xffffff;
        let q = tfhd.s + 8, base = pos, dDur = trexDur, dSize = trexSize;
        if (tf & 0x1) { base = Number(m.getBigUint64(q)); q += 8; }
        if (tf & 0x2) q += 4;
        if (tf & 0x8) { dDur = m.getUint32(q); q += 4; }
        if (tf & 0x10) { dSize = m.getUint32(q); q += 4; }
        const tfdt = first(tc, "tfdt");
        if (tfdt) t = m.getUint8(tfdt.s) === 1 ? Number(m.getBigUint64(tfdt.s + 4)) : m.getUint32(tfdt.s + 4);
        for (const trun of tc.get("trun") ?? []) {
          const rf = m.getUint32(trun.s) & 0xffffff;
          const n = m.getUint32(trun.s + 4);
          let r = trun.s + 8, off = base;
          if (rf & 0x1) { off = base + m.getInt32(r); r += 4; }
          if (rf & 0x4) r += 4;
          for (let i = 0; i < n; i++) {
            let dur = dDur, sz = dSize;
            if (rf & 0x100) { dur = m.getUint32(r); r += 4; }
            if (rf & 0x200) { sz = m.getUint32(r); r += 4; }
            if (rf & 0x400) r += 4;
            if (rf & 0x800) r += 4;
            sizes.push(sz); offsets.push(off); times.push(t / timescale);
            off += sz; t += dur;
          }
        }
      }
    }
    pos += size;
  }
  return { sizes: Uint32Array.from(sizes), offsets: Float64Array.from(offsets), times: Float64Array.from(times), duration: t / timescale };
}

async function parseMp4(file: Blob): Promise<Track | null> {
  const moov = await findTopBox(file, "moov");
  if (!moov || moov.size > 400 * 1024 * 1024) return null;
  const v = await readBytes(file, moov.start, moov.size);
  const top = children(v, 8, v.byteLength);
  for (const trak of top.get("trak") ?? []) {
    const tk = children(v, trak.s, trak.e);
    const mdia = first(tk, "mdia"); if (!mdia) continue;
    const md = children(v, mdia.s, mdia.e);
    const hdlr = first(md, "hdlr"); const mdhd = first(md, "mdhd"); const minf = first(md, "minf");
    if (!hdlr || !mdhd || !minf) continue;
    const handler = String.fromCharCode(v.getUint8(hdlr.s + 8), v.getUint8(hdlr.s + 9), v.getUint8(hdlr.s + 10), v.getUint8(hdlr.s + 11));
    if (handler !== "soun") continue;
    const ver = v.getUint8(mdhd.s);
    const timescale = v.getUint32(mdhd.s + (ver === 1 ? 20 : 12));
    const stblBox = first(children(v, minf.s, minf.e), "stbl"); if (!stblBox) continue;
    const st = children(v, stblBox.s, stblBox.e);
    const stsd = first(st, "stsd"); if (!stsd) continue;
    // first sample entry starts after version/flags(4) + entry_count(4); entry box header is 8 bytes
    const entry = stsd.s + 8;
    const fmt = String.fromCharCode(v.getUint8(entry + 4), v.getUint8(entry + 5), v.getUint8(entry + 6), v.getUint8(entry + 7));
    if (fmt !== "mp4a") return null;
    const entryEnd = entry + v.getUint32(entry);
    const channels = v.getUint16(entry + 8 + 16);
    const sampleRate = v.getUint32(entry + 8 + 24) >>> 16;
    const sub = children(v, entry + 8 + 28, entryEnd);
    let esds = first(sub, "esds");
    if (!esds) { const wave = first(sub, "wave"); if (wave) esds = first(children(v, wave.s, wave.e), "esds"); }
    if (!esds) return null;
    const asc = parseEsds(v, esds.s, esds.e);
    if (!asc || !asc.length) return null;
    const aot = asc[0] >> 3;
    const codec = `mp4a.40.${aot === 5 || aot === 29 ? aot : 2}`;

    // sample sizes
    const stsz = first(st, "stsz"); const stco = first(st, "stco") ?? first(st, "co64"); const stsc = first(st, "stsc"); const stts = first(st, "stts");
    const fragmentedTrack = async () => {
      // fragmented MP4 (screen recorders, OBS, browser recordings, some downloaders): samples live in moof/traf/trun
      const tkhd = first(tk, "tkhd");
      if (!tkhd) return null;
      const trackId = v.getUint32(tkhd.s + (v.getUint8(tkhd.s) === 1 ? 20 : 12));
      let defDur = 0, defSize = 0;
      const mvex = first(top, "mvex");
      for (const trex of mvex ? children(v, mvex.s, mvex.e).get("trex") ?? [] : []) {
        if (v.getUint32(trex.s + 4) === trackId) { defDur = v.getUint32(trex.s + 12); defSize = v.getUint32(trex.s + 16); }
      }
      const fr = await readFragments(file, trackId, defDur, defSize, timescale);
      return fr.sizes.length ? { timescale, sampleRate, channels, asc, codec, ...fr } : null;
    };
    if (!stsz || !stco || !stsc || !stts || v.getUint32(stsz.s + 8) === 0) return fragmentedTrack();
    const fixed = v.getUint32(stsz.s + 4); const count = v.getUint32(stsz.s + 8);
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || v.getUint32(stsz.s + 12 + 4 * i);
    // chunk offsets
    const is64 = !!first(st, "co64");
    const nChunks = v.getUint32(stco.s + 4);
    const chunkOff = new Float64Array(nChunks);
    for (let i = 0; i < nChunks; i++) chunkOff[i] = is64 ? Number(v.getBigUint64(stco.s + 8 + 8 * i)) : v.getUint32(stco.s + 8 + 4 * i);
    // sample → chunk mapping
    const offsets = new Float64Array(count);
    const nsc = v.getUint32(stsc.s + 4);
    let sample = 0;
    for (let k = 0; k < nsc; k++) {
      const firstChunk = v.getUint32(stsc.s + 8 + 12 * k) - 1;
      const perChunk = v.getUint32(stsc.s + 8 + 12 * k + 4);
      const nextFirst = k + 1 < nsc ? v.getUint32(stsc.s + 8 + 12 * (k + 1)) - 1 : nChunks;
      for (let c = firstChunk; c < nextFirst && sample < count; c++) {
        let off = chunkOff[c];
        for (let j = 0; j < perChunk && sample < count; j++) { offsets[sample] = off; off += sizes[sample]; sample++; }
      }
    }
    // decode times
    const times = new Float64Array(count);
    const nts = v.getUint32(stts.s + 4);
    let t = 0; sample = 0;
    for (let k = 0; k < nts; k++) {
      const n = v.getUint32(stts.s + 8 + 8 * k); const d = v.getUint32(stts.s + 8 + 8 * k + 4);
      for (let j = 0; j < n && sample < count; j++) { times[sample++] = t / timescale; t += d; }
    }
    return { timescale, sampleRate, channels, asc, codec, sizes, offsets, times, duration: t / timescale };
  }
  return null;
}

// ------------------------------------------------------------------------------------------ decoding
/** Mixes to mono and resamples to 16 kHz by box-averaging (adequate anti-aliasing for speech). */
class Resampler {
  private acc = 0; private n = 0; private pos = 0;
  constructor(private ratio: number, private push: (x: number) => void) {}
  feed(mono: Float32Array) {
    for (let i = 0; i < mono.length; i++) {
      this.acc += mono[i]; this.n++; this.pos += 1;
      if (this.pos >= this.ratio) { this.push(this.acc / this.n); this.acc = 0; this.n = 0; this.pos -= this.ratio; }
    }
  }
}

function toMono(ad: AudioData): Float32Array {
  const n = ad.numberOfFrames;
  const out = new Float32Array(n);
  const tmp = new Float32Array(n);
  const ch = ad.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    ad.copyTo(tmp, { planeIndex: c, format: "f32-planar" });
    for (let i = 0; i < n; i++) out[i] += tmp[i] / ch;
  }
  return out;
}

class Mp4Audio implements AudioSource {
  duration: number;
  constructor(private file: Blob, private tr: Track) { this.duration = tr.duration; }

  /** Decode samples [a, b) and pass mono PCM (native rate) to `sink`. Reads the file in large blocks. */
  private async decode(a: number, b: number, sink: (mono: Float32Array) => void, onProgress?: (f: number) => void): Promise<void> {
    const tr = this.tr;
    const dec = new AudioDecoder({ output: (ad) => { sink(toMono(ad)); ad.close(); }, error: (e) => { failure = e; } });
    let failure: unknown = null;
    dec.configure({ codec: tr.codec, sampleRate: tr.sampleRate, numberOfChannels: tr.channels, description: tr.asc });
    const BLOCK = 8 * 1024 * 1024;
    let bufStart = -1, buf: Uint8Array | null = null;
    for (let i = a; i < b; i++) {
      if (failure) throw failure;
      const off = tr.offsets[i], size = tr.sizes[i];
      if (!buf || off < bufStart || off + size > bufStart + buf.length) {
        bufStart = off;
        buf = new Uint8Array(await this.file.slice(off, off + Math.max(BLOCK, size)).arrayBuffer());
      }
      dec.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round(tr.times[i] * 1e6), data: buf.subarray(off - bufStart, off - bufStart + size) }));
      if (dec.decodeQueueSize > 64) await new Promise<void>((r) => dec.addEventListener("dequeue", () => r(), { once: true }));
      if (onProgress && (i - a) % 2000 === 0) onProgress((i - a) / Math.max(1, b - a));
    }
    await dec.flush();
    dec.close();
    if (failure) throw failure;
  }

  private index(t: number): number {
    const ts = this.tr.times;
    let lo = 0, hi = ts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; }
    return lo;
  }

  async envelopeDb(onProgress?: (f: number) => void): Promise<number[]> {
    const per = Math.round(this.tr.sampleRate * WIN);
    const out: number[] = [];
    let sum = 0, n = 0;
    await this.decode(0, this.tr.sizes.length, (mono) => {
      for (let i = 0; i < mono.length; i++) {
        sum += mono[i] * mono[i]; n++;
        if (n === per) { out.push(10 * Math.log10(sum / n + 1e-10)); sum = 0; n = 0; }
      }
    }, onProgress);
    return out;
  }

  async pcm(start: number, end: number): Promise<Float32Array> {
    const a = Math.max(0, this.index(start) - 2), b = Math.min(this.tr.sizes.length, this.index(end) + 2);
    const parts: number[] = [];
    const rs = new Resampler(this.tr.sampleRate / SR, (x) => parts.push(x));
    await this.decode(a, b, (mono) => rs.feed(mono));
    const skip = Math.max(0, Math.round((start - this.tr.times[a]) * SR));
    const len = Math.round((end - start) * SR);
    return Float32Array.from(parts.slice(skip, skip + len));
  }
}

/** Whole-file fallback for non-MP4 containers. */
class DecodedAudio implements AudioSource {
  duration: number;
  constructor(private mono16: Float32Array) { this.duration = mono16.length / SR; }
  async envelopeDb(): Promise<number[]> {
    const per = SR * WIN, out: number[] = [];
    for (let i = 0; i + per <= this.mono16.length; i += per) {
      let s = 0;
      for (let j = i; j < i + per; j++) s += this.mono16[j] * this.mono16[j];
      out.push(10 * Math.log10(s / per + 1e-10));
    }
    return out;
  }
  async pcm(start: number, end: number): Promise<Float32Array> {
    return this.mono16.slice(Math.max(0, Math.round(start * SR)), Math.round(end * SR));
  }
}

export class AudioUnsupported extends Error {}

export async function openAudio(file: Blob, forceDecode = false): Promise<AudioSource> {
  if (!forceDecode && typeof AudioDecoder !== "undefined") {
    const tr = await parseMp4(file).catch(() => null);
    if (tr) {
      const ok = await AudioDecoder.isConfigSupported({ codec: tr.codec, sampleRate: tr.sampleRate, numberOfChannels: tr.channels, description: tr.asc }).catch(() => ({ supported: false }));
      if (ok.supported) return new Mp4Audio(file, tr);
    }
  }
  if (file.size > 450 * 1024 * 1024) throw new AudioUnsupported("large-non-mp4");
  const ctx = new OfflineAudioContext(1, 1, SR);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer()).catch(() => { throw new AudioUnsupported("decode"); });
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  return new DecodedAudio(mono);
}

/**
 * Pick the stretches of a long video that are worth transcribing: steady speech plus moments of
 * energy, spread over the whole video. Returns [start, end] spans in seconds, sorted by time.
 */
export function pickSpans(db: number[], duration: number, budget: number, span = 150): [number, number][] {
  if (duration <= budget + 60) return [[0, duration]];
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] ?? -60;
  const per = Math.round(span / WIN);
  const scores: { t: number; s: number }[] = [];
  for (let i = 0; i + per <= db.length; i += Math.round(per / 3)) {
    let active = 0, mean = 0, peak = -120;
    for (let j = i; j < i + per; j++) { if (db[j] > floor + 8) active++; mean += db[j]; peak = Math.max(peak, db[j]); }
    mean /= per;
    const speech = active / per;                      // talking most of the time
    const dyn = Math.min(1, Math.max(0, (peak - mean) / 20)); // some excitement inside
    scores.push({ t: i * WIN, s: (speech > 0.55 ? speech : speech * 0.5) + 0.35 * dyn });
  }
  const n = Math.max(1, Math.floor(budget / span));
  // one best span per equal slice of the video keeps the picks spread out, then fill with the next best
  const chosen: { t: number; s: number }[] = [];
  const slice = duration / n;
  for (let k = 0; k < n; k++) {
    const inSlice = scores.filter((x) => x.t >= k * slice && x.t < (k + 1) * slice);
    const best = inSlice.sort((a, b) => b.s - a.s)[0];
    if (best && best.s > 0.3) chosen.push(best);
  }
  for (const x of [...scores].sort((a, b) => b.s - a.s)) {
    if (chosen.length >= n) break;
    if (chosen.every((c) => Math.abs(c.t - x.t) >= span)) chosen.push(x);
  }
  return chosen.map((c) => [c.t, Math.min(duration, c.t + span)] as [number, number]).sort((a, b) => a[0] - b[0]);
}

/** Loud moments (laughter, shouting, applause) relative to the speaker's normal level. */
export function energyPeaks(db: number[]): number[] {
  if (db.length < 20) return [];
  const sorted = [...db].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)], p97 = sorted[Math.floor(sorted.length * 0.97)];
  if (p97 - p50 < 6) return [];
  const out: number[] = [];
  db.forEach((x, i) => { if (x >= p97 && (!out.length || i * WIN - out[out.length - 1] > 20)) out.push(i * WIN); });
  return out;
}

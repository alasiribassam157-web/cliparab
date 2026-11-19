import type { WordT } from "./types";

/** Port of cliparab_core.text_ar.chunk_words_for_captions / split_two_lines (used for the live preview). */
export function chunkWords(words: WordT[], maxChars = 22, maxLines = 2): WordT[][] {
  const events: WordT[][] = [];
  let cur: WordT[] = [];
  let chars = 0;
  const limit = maxChars * maxLines;
  words.forEach((w, i) => {
    let add = w.text.length + (cur.length ? 1 : 0);
    if (cur.length && chars + add > limit) {
      events.push(cur);
      cur = [];
      chars = 0;
      add = w.text.length;
    }
    cur.push(w);
    chars += add;
    const nxt = words[i + 1];
    const hard = /[،,.؟?!؛…]$/.test(w.text.trim());
    const pause = nxt !== undefined && nxt.start - w.end > 0.55;
    if ((hard || pause) && chars >= maxChars * 0.6) {
      events.push(cur);
      cur = [];
      chars = 0;
    }
  });
  if (cur.length) {
    if (events.length && cur.length === 1 && events[events.length - 1].length + 1 <= 7) events[events.length - 1].push(...cur);
    else events.push(cur);
  }
  return events;
}

export function splitTwoLines(words: WordT[], maxChars = 22): WordT[][] {
  const total = words.reduce((a, w) => a + w.text.length, 0) + Math.max(words.length - 1, 0);
  if (total <= maxChars || words.length < 3) return [words];
  let bestK = 1;
  let bestDiff = Infinity;
  let run = 0;
  for (let k = 1; k < words.length; k++) {
    run += words[k - 1].text.length + 1;
    const diff = Math.abs(run - (total - run));
    if (diff < bestDiff) {
      bestK = k;
      bestDiff = diff;
    }
  }
  return [words.slice(0, bestK), words.slice(bestK)];
}

const norm = (s: string) => s.replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[.،,؟?!؛:"«»()]/g, "");
export const isEmphasis = (w: string, list: string[]) => list.some((e) => norm(e) === norm(w));

export interface ActiveCaption {
  lines: { w: WordT; spoken: boolean; emphasis: boolean }[][];
  mode: string;
}

/** Caption state at absolute source time ``t`` for a clip's words. */
export function captionAt(events: WordT[][], t: number, mode: string, emphasis: string[], maxChars: number): ActiveCaption | null {
  if (mode === "pop") {
    const w = events.flat().find((x) => t >= x.start && t < Math.max(x.end, x.start + 0.25));
    return w ? { mode, lines: [[{ w, spoken: true, emphasis: isEmphasis(w.text, emphasis) }]] } : null;
  }
  const ev = events.find((e) => t >= e[0].start && t <= Math.max(e[e.length - 1].end, e[0].start + 0.4));
  if (!ev) return null;
  const lines = splitTwoLines(ev, maxChars).map((row) => row.map((w) => ({ w, spoken: t >= w.start, emphasis: isEmphasis(w.text, emphasis) })));
  return { mode, lines };
}

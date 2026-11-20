/**
 * Browser port of the ClipArab engine (packages/core/cliparab_core): Arabic text heuristics, sentence
 * splitting, topic segmentation, candidate generation with boundary repair, ClipScore and diversification.
 * Kept deliberately close to the Python so both engines suggest the same clips for the same transcript.
 */
import type { ScoreKey, Suggestion, WordT } from "../types";

/** `eos`: last word of a recognised speech segment — a natural pause, used as a sentence end when there is no punctuation. */
export interface Word extends WordT { speaker?: string | null; eos?: boolean }
export interface Sentence { id: number; start: number; end: number; text: string; words: Word[]; speaker: string | null }
interface Candidate {
  start: number; end: number; first: number; last: number; text: string; flags: string[]; chapter: number;
  scores: Record<ScoreKey, number>; penalties: Record<string, number>; total: number;
  clip_type: string; title: string; reason_ar: string; hooks: { type: string; text: string }[]; emphasis: string[];
}

// ------------------------------------------------------------------------------------------ text_ar
const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const EDGE = "\\s\"'«»()\\[\\]{}،,؛;:.!؟?…\\-–—";
const PUNCT_EDGE = new RegExp(`^[${EDGE}]+|[${EDGE}]+$`, "g");
const END_PUNCT = [".", "!", "؟", "?", "…", "؛"];
const DIGITS: Record<string, string> = Object.fromEntries([..."٠١٢٣٤٥٦٧٨٩"].map((c, i) => [c, String(i)]).concat([..."۰۱۲۳۴۵۶۷۸۹"].map((c, i) => [c, String(i)])));

export function normalize(text: string): string {
  if (LANG === "en") return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();
  return text.replace(TASHKEEL, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[٠-٩۰-۹]/g, (c) => DIGITS[c] ?? c);
}
export const stripEdges = (w: string) => w.replace(PUNCT_EDGE, "");
export const normTokens = (text: string) => text.split(/\s+/).map(stripEdges).filter(Boolean).map(normalize);

const set = (s: string) => new Set(s.split(" "));
const DANGLING_START = set("هذا هذه هاذا هاذي ذلك تلك هو هي هم هن هما هؤلاء اولئك ده دي دول هاد هاي هادي هيك كده كدا هادا هذي لكن لذلك لذا اذن يعني ثم بعدين بعدها لان كذلك ايضا اما وبالتالي وبعدين وبعدها ولذلك وايضا وكذلك فبالتالي طيب اها ايوه ايوا بالضبط النتيجه الخلاصه باختصار");
const WAW_ROOTS = "وقت وجه واحد واضح وصف وزن وطن ورق وسط وضع وصل وعد وظيف وحد وراء وزار وسائل وسيل وثيق وعي ولد ولاد وقف وفاه والد والي وهم وحش وجود وجد وقع وفر وصي ورد وعاء ورش وكال وكيل وسام وجبه وجبات ولاي وليد".split(" ");
const DANGLING_PREFIX_BASE = set("هذا هذه هو هي هم ذلك تلك هاد هاي ده دي لكن لان");
const INCOMPLETE_END = set("و ف ثم لكن لان ان اللي الذي التي الذين يعني مثل حتي او في علي من الي عن مع لما اذا كي لكي ب ل ك ما لا هل بس كان كانت");
const QUESTION_WORDS = set("ماذا لماذا كيف هل متي اين من ما ماهي ماهو كم ليش ليه شلون وش ايش شو ازاي امتي فين كيفاش علاش اش قداش شنو اشمن علاه");
const POWER = ["سر", "اسرار", "اخطر", "اكبر خطا", "لا تفعل", "لن تصدق", "الحقيقه", "ممنوع", "احذر", "كارثه", "مجانا", "افضل", "اسوا", "خطا", "خطاء", "الخطا", "ما يعرفه", "لا احد", "محد", "ابدا", "اهم", "غلطه", "صدمه", "مفاجاه"];
const CURIOSITY = ["الكل يظن", "معظم الناس", "اغلب الناس", "ما يقوله", "ما تعرفه", "لو", "تخيل", "انتبه", "الفرق بين", "ليه", "لماذا"];
const FILLER_START = set("امم اممم اه ااه ايه اها طيب خلاص يعني بس");
const VALUE = ["لازم", "يجب", "نصيحه", "خطوه", "الطريقه", "القاعده", "مثال", "لان", "النتيجه", "تقدر", "ينفع", "الحل", "سبب", "اولا", "ثانيا", "ثالثا", "الاول", "الثاني", "افضل طريقه", "تجنب", "ابدا", "ركز", "استخدم"];
const CONCLUSION = ["الخلاصه", "النتيجه", "باختصار", "المهم", "لهذا", "لذلك", "ولهذا", "وبالتالي", "ببساطه", "الخلاصه", "في النهايه"];
const STORY = ["قصه", "في يوم", "حصل لي", "حدثت", "تذكر", "كنت", "ذات مره", "مره", "عندما كنت", "اتذكر", "وقتها"];
const OPINION = ["رايي", "برايي", "اعتقد", "انا اشوف", "ما اتفق", "اختلف", "لا اتفق", "وجهه نظري", "غلط", "مبالغ", "ارى", "انا ارى"];
const COMEDY = ["ههه", "هههه", "نكته", "اضحك", "ضحك", "مضحك", "تخيل", "😂"];
const QUOTE = ["قال", "مقوله", "اقتباس", "كما قيل", "يقولون", "حكمه"];
const MARKETING = ["عرض", "خصم", "منتج", "اشترك", "جرب", "تواصل معنا", "الرابط", "خدمه", "احجز", "اطلب", "تسجيل", "مجانا"];
export const STOPWORDS = set("في من علي الي عن مع هذا هذه ذلك التي الذي كان كانت ليس لكن ثم او ان انه انها كل قد هو هي ما لا نعم يعني اللي عند بعد قبل حتي اذا كيف لماذا ماذا الان جدا بس وهو وهي انا انت نحن هم هل اي كده ده دي");
const TRANSITIONS = ["ننتقل", "موضوع ثاني", "موضوع اخر", "نكمل", "الحلقه القادمه", "الفيديو القادم", "اشتركوا", "اشترك في القناه", "لا تنسوا", "شكرا لكم", "شكرا لمتابعتكم", "الي اللقاء", "الى اللقاء", "ضغطه لايك", "لايك واشتراك", "السلام عليكم"].map(normalize);
const NUM_WORDS = set("واحد اثنين ثلاثه اربعه خمسه عشره ثلاث خمس سبع مليون الف");
export const CLIP_TYPE_LABELS_AR: Record<string, string> = {
  viral: "الأكثر قابلية للانتشار", educational: "تعليمي", opinion: "رأي", story: "قصة", comedy: "كوميدي",
  quote: "اقتباس", short: "قصير جدًا", marketing: "مناسب لإعلان أو تسويق",
};


// ------------------------------------------------------------------------------------------ language lexicons
interface Lex {
  DANGLING_START: Set<string>; DANGLING_PREFIX_BASE: Set<string>; INCOMPLETE_END: Set<string>; QUESTION_WORDS: Set<string>;
  POWER: string[]; CURIOSITY: string[]; FILLER_START: Set<string>; VALUE: string[]; CONCLUSION: string[]; STORY: string[];
  OPINION: string[]; COMEDY: string[]; QUOTE: string[]; MARKETING: string[]; STOPWORDS: Set<string>; TRANSITIONS: string[]; NUM_WORDS: Set<string>;
  minEmphasisLen: number;
}
const AR_LEX: Lex = { DANGLING_START, DANGLING_PREFIX_BASE, INCOMPLETE_END, QUESTION_WORDS, POWER, CURIOSITY, FILLER_START, VALUE, CONCLUSION, STORY, OPINION, COMEDY, QUOTE, MARKETING, STOPWORDS, TRANSITIONS, NUM_WORDS, minEmphasisLen: 5 };
const EN_LEX: Lex = {
  DANGLING_START: set("and but so because which then also or however therefore thus yet plus those these he she they them his her their its"),
  DANGLING_PREFIX_BASE: new Set(),
  INCOMPLETE_END: set("and but or so because that which who whom whose the a an of to in on for with by at from as if than then like about into my your our their his her its this these those is are was were be been am will would can could should may might have has had do does did not no very really just also too more most"),
  QUESTION_WORDS: set("what why how who whom whose when where which is are do does did can could would should will have has isn't aren't don't doesn't didn't can't"),
  POWER: ["secret", "secrets", "mistake", "mistakes", "never", "nobody", "truth", "warning", "danger", "dangerous", "biggest", "worst", "shocking", "insane", "crazy", "huge", "destroy", "destroyed", "killed", "wrong", "lie", "lies", "myth", "myths", "stop", "dont", "don't", "banned", "illegal", "exposed", "hidden", "nobody tells you", "no one tells you", "the real reason", "game changer"],
  CURIOSITY: ["everyone thinks", "most people", "what if", "imagine", "here's the thing", "the truth is", "you won't believe", "the reason", "turns out", "but here's", "nobody talks about", "what nobody", "the difference", "think about", "wait", "listen", "guess what", "the problem is", "here's why", "let me explain"],
  FILLER_START: set("um uh uhm hmm er ah oh well okay ok yeah alright anyway like so"),
  VALUE: ["you need", "you should", "you have to", "step", "steps", "tip", "tips", "rule", "because", "for example", "for instance", "the way", "how to", "learn", "works", "result", "means", "key", "the trick", "simple", "easy", "so that", "that's why", "which means", "important", "reason", "method", "strategy", "lesson", "mistake"],
  CONCLUSION: ["in short", "bottom line", "the point is", "the key is", "that's why", "so basically", "in the end", "to sum up", "remember", "at the end of the day", "that's it", "the takeaway", "the lesson", "so if you", "and that's", "that is why"],
  STORY: ["story", "one day", "i was", "i remember", "years ago", "when i was", "i used to", "happened", "back then", "we were", "it was", "this one time", "i got", "so i"],
  OPINION: ["i think", "i believe", "in my opinion", "i disagree", "i don't think", "i feel", "honestly", "i'd say", "to me", "overrated", "unpopular opinion", "i personally"],
  COMEDY: ["haha", "lol", "funny", "joke", "laugh", "laughing", "hilarious", "ridiculous", "😂"],
  QUOTE: ["quote", "they say", "as the saying", "famous", "proverb", "wise man"],
  MARKETING: ["discount", "offer", "buy now", "sale", "subscribe", "link below", "sign up", "book now", "order now", "limited time", "free trial", "promo", "check out", "use code", "coupon", "link in the description"],
  STOPWORDS: set("the a an and or but if of to in on for with by at from as is are was were be been am it its this that these those i you he she we they me him her us them my your his our their not no so very just also too then than there here what which who when where how why do does did have has had can could would should will would may might about into over out up down more most some any all each other such only own same can't don't won't it's that's i'm you're we're they're he's she's there's going get got really like yeah okay"),
  TRANSITIONS: ["subscribe", "thanks for watching", "see you next", "next video", "like and subscribe", "before we move on", "moving on", "let's move on", "next topic", "in the next", "welcome back", "hey guys", "what's up guys", "don't forget to", "smash that", "link in the description", "thank you for watching", "thanks for listening", "sponsor", "sponsored by"],
  NUM_WORDS: set("one two three four five six seven eight nine ten twenty thirty fifty hundred thousand million billion first second third"),
  minEmphasisLen: 6,
};
let LANG: "ar" | "en" = "ar";
let L: Lex = AR_LEX;
export function setEngineLang(l: "ar" | "en") { LANG = l; L = l === "en" ? EN_LEX : AR_LEX; }
export const engineLang = () => LANG;

const containsAny = (n: string, markers: string[]) => {
  if (LANG === "en") { const p = ` ${n} `; return markers.reduce((a, m) => a + (p.includes(` ${m} `) ? 1 : 0), 0); }
  return markers.reduce((a, m) => a + (n.includes(m) ? 1 : 0), 0);
};
const endsSentence = (w: string) => END_PUNCT.some((p) => w.replace(/["'») ]+$/, "").endsWith(p));

export function splitSentences(words: Word[], gap = 0.8, minWords = 4, maxWords = 45): Sentence[] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const nxt = words[i + 1];
    if (!nxt || endsSentence(w.text) || w.eos || nxt.start - w.end > gap || (w.speaker ?? null) !== (nxt.speaker ?? null)) { groups.push(cur); cur = []; }
  });
  const merged: Word[][] = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (last && last.length < minWords && !/[؟?]$/.test(last[last.length - 1].text.trim()) && (last[last.length - 1].speaker ?? null) === (g[0].speaker ?? null)) last.push(...g);
    else merged.push(g);
  }
  if (merged.length > 1 && merged[merged.length - 1].length < minWords && (merged[merged.length - 2].at(-1)!.speaker ?? null) === (merged[merged.length - 1][0].speaker ?? null)) {
    merged[merged.length - 2].push(...merged.pop()!);
  }
  const final: Word[][] = [];
  for (let g of merged) {
    while (g.length > maxWords) {
      const lo = 8, hi = g.length - 8;
      if (hi <= lo) break;
      let k = lo, best = -Infinity;
      for (let j = lo; j < hi; j++) { const p = j + 1 < g.length ? g[j + 1].start - g[j].end : 0; if (p > best) { best = p; k = j; } }
      final.push(g.slice(0, k + 1));
      g = g.slice(k + 1);
    }
    final.push(g);
  }
  return final.filter((g) => g.length).map((g, i) => ({ id: i, start: g[0].start, end: g[g.length - 1].end, text: g.map((w) => w.text).join(" "), words: g, speaker: g[0].speaker ?? null }));
}

export function startsDangling(text: string): boolean {
  const toks = normTokens(text);
  if (!toks.length) return true;
  const f = toks[0];
  if (L.DANGLING_START.has(f)) return true;
  if (LANG === "ar" && (f.startsWith("و") || f.startsWith("ف")) && L.DANGLING_PREFIX_BASE.has(f.slice(1))) return true;
  if (LANG === "ar" && f.startsWith("و") && f.length >= 4 && !WAW_ROOTS.some((r) => f.startsWith(r))) return true;
  return L.FILLER_START.has(f) && toks.length <= 3;
}
export function endsIncomplete(text: string): boolean {
  const s = text.trimEnd();
  if (["،", ",", ":", "-", "..."].some((p) => s.endsWith(p))) return true;
  const toks = normTokens(text);
  return !toks.length || L.INCOMPLETE_END.has(toks[toks.length - 1]);
}
export const isTransition = (text: string) => { const n = normalize(text); return L.TRANSITIONS.some((t) => n.includes(t)); };
export function isQuestion(text: string): boolean {
  if (text.includes("؟") || text.includes("?")) return true;
  const t = normTokens(text);
  return t.length > 0 && L.QUESTION_WORDS.has(t[0]);
}
export function hookStrength(first: string): number {
  const n = normalize(first);
  const toks = n.split(/\s+/).filter(Boolean);
  let s = 0.15;
  if (isQuestion(first)) s += 0.3;
  if (/\d/.test(n) || toks.slice(0, 12).some((t) => L.NUM_WORDS.has(t))) s += 0.15;
  if (containsAny(n, L.POWER)) s += 0.25;
  if (containsAny(n, L.CURIOSITY)) s += 0.15;
  if (toks.length >= 3 && toks.length <= 14) s += 0.1;
  if (toks.length && L.FILLER_START.has(toks[0])) s -= 0.2;
  if (toks.length > 28) s -= 0.1;
  return Math.max(0, Math.min(1, s));
}
export function valueStrength(text: string): number {
  const n = normalize(text);
  const hits = containsAny(n, L.VALUE) + containsAny(n, L.CONCLUSION) + containsAny(n, L.STORY) + containsAny(n, L.OPINION);
  const digits = (n.match(/\d+/g) ?? []).length;
  const words = Math.max(n.split(/\s+/).filter(Boolean).length, 1);
  const density = Math.min(1, (hits + 0.5 * digits) / Math.max(3, words / 12));
  return Math.max(0.15, Math.min(1, 0.25 + 0.6 * density));
}
export function conclusionStrength(last: string): number {
  const n = normalize(last);
  let s = 0.35;
  if (containsAny(n, L.CONCLUSION)) s += 0.35;
  if (/[.!؟?]$/.test(last.trimEnd())) s += 0.2;
  if (n.split(/\s+/).filter(Boolean).length >= 6) s += 0.1;
  if (endsIncomplete(last)) s -= 0.45;
  return Math.max(0, Math.min(1, s));
}
export function classifyClip(text: string, duration: number, hook: number): string {
  const n = normalize(text);
  if (containsAny(n, L.COMEDY) >= 1) return "comedy";
  if (containsAny(n, L.MARKETING) >= 2) return "marketing";
  if (containsAny(n, L.STORY) >= 2) return "story";
  if (containsAny(n, L.OPINION) >= 1) return "opinion";
  if (containsAny(n, L.QUOTE) >= 1 && duration <= 30) return "quote";
  if (containsAny(n, L.VALUE) >= 2) return "educational";
  if (hook >= 0.7) return "viral";
  return duration <= 20 ? "short" : "educational";
}
export function emphasisWords(text: string, n = 4): string[] {
  const seen: string[] = [];
  const toks = text.split(/\s+/).map(stripEdges);
  for (const t of toks) if (/\d/.test(normalize(t)) && !seen.includes(t)) seen.push(t);
  const content = toks.filter((t) => t && !L.STOPWORDS.has(normalize(t)) && normalize(t).length >= L.minEmphasisLen && !/\d/.test(normalize(t)));
  content.sort((a, b) => normalize(b).length - normalize(a).length);
  for (const t of content) { if (seen.length >= n) break; if (!seen.includes(t)) seen.push(t); }
  return seen.slice(0, n);
}

// ------------------------------------------------------------------------------------------ topics
function lightStem(t: string): string {
  if (LANG === "en") return t.length > 4 ? t.replace(/(ing|ed|ly|es|s)$/, "") : t;
  for (const p of ["وال", "بال", "لل", "فال", "كال", "ال", "و", "ب", "ل"]) if (t.startsWith(p) && t.length - p.length >= 3) { t = t.slice(p.length); break; }
  for (const s of ["ات", "ون", "ين", "ان", "ه", "ها", "هم", "ي"]) if (t.endsWith(s) && t.length - s.length >= 3) { t = t.slice(0, -s.length); break; }
  return t;
}
function bag(ss: Sentence[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of ss) for (const t of normTokens(s.text)) if (!L.STOPWORDS.has(t) && t.length > 2) { const k = lightStem(t); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}
function cos(a: Map<string, number>, b: Map<string, number>): number {
  if (!a.size || !b.size) return 0;
  let dot = 0, na = 0, nb = 0;
  a.forEach((v, k) => { dot += v * (b.get(k) ?? 0); na += v * v; });
  b.forEach((v) => { nb += v * v; });
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
export function segmentTopics(ss: Sentence[], window = 4, minSent = 4, minSec = 40): number[] {
  const n = ss.length;
  if (n <= minSent * 2) return new Array(n).fill(0);
  const sims: number[] = [];
  for (let i = 1; i < n; i++) sims.push(cos(bag(ss.slice(Math.max(0, i - window), i)), bag(ss.slice(i, i + window))));
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  const sd = Math.sqrt(sims.reduce((a, x) => a + (x - mean) ** 2, 0) / sims.length) || 1e-9;
  const cutoff = mean - 0.5 * sd;
  const bounds = [0];
  for (let k = 1; k < sims.length - 1; k++) {
    const i = k + 1;
    if (sims[k] < cutoff && sims[k] <= sims[k - 1] && sims[k] <= sims[k + 1] && i - bounds[bounds.length - 1] >= minSent && n - i >= minSent
      && ss[i].start - ss[bounds[bounds.length - 1]].start >= minSec) bounds.push(i);
  }
  const b = new Set(bounds.slice(1));
  let ch = 0;
  return ss.map((_, i) => (b.has(i) ? ++ch : ch));
}

// ------------------------------------------------------------------------------------------ candidates
const TARGETS = [20, 30, 45, 58];
function generateCandidates(ss: Sentence[], duration: number, minD = 15, maxD = 60): Candidate[] {
  const n = ss.length;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (let i0 = 0; i0 < n; i0++) {
    let i = i0, back = 0;
    const flags: string[] = [];
    while (startsDangling(ss[i].text) && i > 0 && back < 2 && ss[i - 1].end - ss[i - 1].start < 15) { i--; back++; }
    if (back) flags.push(`start_repaired:${back}`);
    const picks: [number, number][] = [];
    for (let j = i; j < n; j++) {
      const dur = ss[j].end - ss[i].start;
      if (dur < minD) continue;
      if (dur > maxD) break;
      const fit = Math.min(...TARGETS.map((t) => Math.abs(dur - t))) / 30;
      picks.push([conclusionStrength(ss[j].text) - 0.3 * fit, j]);
    }
    picks.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    for (const [, j] of picks.slice(0, 3)) {
      let jj = j, fwd = 0;
      while (endsIncomplete(ss[jj].text) && jj + 1 < n && fwd < 2 && ss[jj + 1].end - ss[i].start <= maxD) { jj++; fwd++; }
      const key = `${i}:${jj}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const f = [...flags];
      if (fwd) f.push(`end_repaired:${fwd}`);
      // start on the first real word: skip "um, so, well…" at the very beginning (never leaves fewer than 5 words)
      const ws = ss[i].words;
      let lead = 0;
      while (lead < 3 && ws.length - lead > 5 && L.FILLER_START.has(normTokens(ws[lead].text)[0] ?? "")) lead++;
      if (lead) f.push(`lead_trimmed:${lead}`);
      out.push({
        start: Math.max(0, (lead ? ws[lead].start : ss[i].start) - 0.15), end: Math.min(ss[jj].end + 0.25, duration || Infinity), first: i, last: jj,
        text: ss.slice(i, jj + 1).map((s) => s.text).join(" "), flags: f, chapter: 0,
        scores: { hook: 0, complete: 0, value: 0, audio: 0, visual: 0, engage: 0 }, penalties: {}, total: 0,
        clip_type: "", title: "", reason_ar: "", hooks: [], emphasis: [],
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ scoring
const WEIGHTS: Record<ScoreKey, number> = { hook: 20, complete: 25, value: 20, audio: 10, visual: 10, engage: 15 };
const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
function zscore(v: number, pop: number[]): number {
  if (pop.length < 3) return 0;
  const m = pop.reduce((a, b) => a + b, 0) / pop.length;
  let sd = Math.sqrt(pop.reduce((a, x) => a + (x - m) ** 2, 0) / pop.length);
  sd = Math.max(sd, 0.1 * Math.abs(m), 1e-6);
  return Math.max(-3, Math.min(3, (v - m) / sd));
}
function paceRates(words: Word[], window = 20): number[] {
  if (words.length < 2) return [];
  const pop: number[] = [];
  for (let t = words[0].start; t + window <= words[words.length - 1].end + 1e-6; t += window / 2) {
    const c = words.filter((w) => w.start >= t && w.end <= t + window).length;
    if (c >= 5) pop.push(c / window);
  }
  return pop;
}
const titleFrom = (text: string, limit = 8) => {
  const words = text.replace(/؟/g, "؟.").split(/(?<=[.!?])\s|\.(?=\s|$)/)[0].trim().split(/\s+/).filter(Boolean);
  while (words.length > 5 && L.FILLER_START.has(normTokens(words[0])[0] ?? "")) words.shift();
  if (LANG === "en" && words[0]) words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return words.slice(0, limit).join(" ") + (words.length > limit ? "…" : "");
};
function reasonAr(hook: number, comp: number, value: number, type: string, flags: string[]): string {
  const parts: string[] = [];
  if (hook >= 0.6) parts.push("افتتاحية جاذبة");
  if (comp >= 0.8) parts.push("فكرة مكتملة بنهاية واضحة");
  if (value >= 0.6) parts.push("قيمة معلوماتية واضحة");
  if (flags.includes("energy_peak")) parts.push("لحظة حماس واضحة في الصوت");
  parts.push(`النوع: ${CLIP_TYPE_LABELS_AR[type] ?? type}`);
  return parts.join("، ");
}

function scoreCandidate(c: Candidate, ss: Sentence[], rates: number[], rmsDb: number[] | null, visual: number | null): Candidate {
  const sents = ss.slice(c.first, c.last + 1);
  const words = sents.flatMap((s) => s.words);
  const first = sents[0].text, last = sents[sents.length - 1].text;
  const hook = hookStrength(first);
  const complete = Math.min(1, (startsDangling(c.text) ? 0 : 0.55) + 0.45 * conclusionStrength(last));
  const value = valueStrength(c.text);
  const dur = c.end - c.start;
  c.clip_type = classifyClip(c.text, dur, hook);
  c.emphasis = emphasisWords(c.text);
  c.title = titleFrom(first);
  c.hooks = [{ type: isQuestion(first) ? "question" : "statement", text: titleFrom(first, 9) }];

  let spoken = 0;
  for (const w of words) spoken += Math.max(0, Math.min(w.end, c.end) - Math.max(w.start, c.start));
  const sr = Math.min(1, spoken / Math.max(dur, 1e-6));
  const conf = words.length ? words.reduce((a, w) => a + (w.conf ?? 0.9), 0) / words.length : 0;
  let pause = 0;
  for (let k = 1; k < words.length; k++) pause = Math.max(pause, words[k].start - words[k - 1].end);
  let audio = 0.5 * Math.min(1, sr / 0.85) + 0.4 * conf + 0.1 * (pause < 1.5 ? 1 : 0) - (pause > 3 ? 0.25 : 0);
  audio = Math.max(0, Math.min(1, audio));

  let engage = sigmoid(0.9 * zscore(words.length / Math.max(dur, 1e-6), rates));
  if (rmsDb && rmsDb.length) {
    const mean = rmsDb.reduce((a, b) => a + b, 0) / rmsDb.length;
    engage = 0.7 * engage + 0.3 * sigmoid(0.7 * zscore(mean, rmsDb));
  }
  engage = Math.min(engage, 0.8);
  const vis = visual == null ? 0.6 : Math.max(0, Math.min(1, visual));
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  c.scores = { hook: r3(hook), complete: r3(complete), value: r3(value), audio: r3(audio), visual: r3(vis), engage: r3(engage) };

  const pen: Record<string, number> = {};
  if (endsIncomplete(last)) pen.ends_mid_thought = 25;
  if (startsDangling(c.text)) { pen.dangling_start = 20; pen.needs_context = 18; }
  if (sr < 0.45) pen.low_speech_ratio = 15;
  if (conf < 0.55 && words.length) pen.low_asr_confidence = 15;
  if (dur < 12 || dur > 75) pen.bad_duration = 10;
  else {
    const fit = dur < 20 ? (20 - dur) * 0.5 : dur > 50 ? (dur - 50) * 0.8 : 0;
    if (fit > 0) pen.duration_fit = Math.round(Math.min(fit, 8) * 10) / 10;
  }
  if (sents.some((s) => isTransition(s.text))) pen.transition_phrase = 10;
  c.penalties = pen;
  const arc = isQuestion(first) && sents.length >= 2 && conclusionStrength(last) >= 0.55 ? 4 : 0; // a question that gets answered
  if (arc) c.flags.push("qa_arc");
  const raw = arc + (Object.keys(WEIGHTS) as ScoreKey[]).reduce((a, k) => a + WEIGHTS[k] * c.scores[k], 0) - Math.min(40, Object.values(pen).reduce((a, b) => a + b, 0));
  c.total = Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
  c.reason_ar = reasonAr(hook, complete, value, c.clip_type, c.flags);
  return c;
}

function passes(c: Candidate, minTotal: number): boolean {
  const p = c.penalties;
  if ("dangling_start" in p && "needs_context" in p && c.scores.complete < 0.5) return false;
  if ("low_speech_ratio" in p || "low_asr_confidence" in p || "transition_phrase" in p) return false;
  if ("ends_mid_thought" in p && c.scores.complete < 0.5) return false;
  return c.total >= minTotal;
}
const overlap = (a: Candidate, b: Candidate) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.max(Math.min(a.end - a.start, b.end - b.start), 1e-6);
const topicSet = (c: Candidate) => new Set(normTokens(c.text).filter((t) => t.length > 2 && !L.STOPWORDS.has(t)).map(lightStem));
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
}
function diversify(cands: Candidate[], limit: number): Candidate[] {
  const pool = [...cands].sort((a, b) => b.total - a.total);
  const sets = new Map<Candidate, Set<string>>();
  const setOf = (c: Candidate) => { let x = sets.get(c); if (!x) { x = topicSet(c); sets.set(c, x); } return x; };
  const chosen: Candidate[] = [];
  while (pool.length && chosen.length < limit) {
    let best = -1, bestVal = -1e9;
    pool.forEach((c, idx) => {
      if (chosen.some((s) => overlap(c, s) > 0.3 || jaccard(setOf(c), setOf(s)) > 0.55)) return;
      const red = Math.max(0, ...chosen.map((s) => overlap(c, s)));
      const chap = 0.08 * chosen.filter((s) => s.chapter === c.chapter).length * 100;
      const val = 0.75 * c.total - 25 * red - chap;
      if (val > bestVal) { bestVal = val; best = idx; }
    });
    if (best < 0) break;
    chosen.push(pool.splice(best, 1)[0]);
  }
  return chosen.sort((a, b) => b.total - a.total);
}

export interface AnalyzeInput {
  /** One or more transcribed spans; candidates never cross a span boundary (long videos are only partly transcribed). */
  spans: Word[][];
  duration: number;
  maxClips: number;
  /** Language of the speech: selects the lexicons (hooks, fillers, conclusions…). Default Arabic. */
  lang?: "ar" | "en";
  /** RMS level in dB per 0.5 s of the whole source (optional). */
  rmsDb?: number[] | null;
  /** Times (s) of loudness peaks; clips that contain one get a small engagement bonus. */
  peaks?: number[];
}

/** Full analysis: sentences → chapters → candidates → ClipScore → filters → MMR. Returns ranked suggestions. */
export function suggestClips(inp: AnalyzeInput): Suggestion[] {
  setEngineLang(inp.lang ?? "ar");
  const all: { c: Candidate; ss: Sentence[] }[] = [];
  let chapterBase = 0;
  const allWords = inp.spans.flat();
  const rates = paceRates(allWords);
  for (const span of inp.spans) {
    if (span.length < 4) continue;
    const ss = splitSentences(span);
    const chapters = segmentTopics(ss).map((x) => x + chapterBase);
    chapterBase = (chapters[chapters.length - 1] ?? chapterBase) + 1;
    for (const c of generateCandidates(ss, inp.duration)) {
      c.chapter = chapters[c.first] ?? 0;
      if (inp.peaks?.some((t) => t >= c.start && t <= c.end)) c.flags.push("energy_peak");
      all.push({ c, ss });
    }
  }
  const scored = all.map(({ c, ss }) => {
    const win = inp.rmsDb ? inp.rmsDb.slice(Math.floor(c.start / 0.5), Math.floor(c.end / 0.5)) : null;
    const s = scoreCandidate(c, ss, rates, win && win.length ? win : null, null);
    if (s.flags.includes("energy_peak")) s.total = Math.min(100, Math.round((s.total + 3) * 10) / 10);
    return s;
  });
  // Strict filters first; if a casual/low-quality transcript leaves too little, relax so the user still gets clips.
  let ok = scored.filter((c) => passes(c, 40));
  if (ok.length < Math.min(3, inp.maxClips)) ok = scored.filter((c) => !("transition_phrase" in c.penalties) && c.total >= 25);
  if (ok.length < Math.min(3, inp.maxClips)) ok = scored;
  return diversify(ok, inp.maxClips).map((c, i) => ({
    id: `c${String(i + 1).padStart(2, "0")}`, rank: i + 1, start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000,
    duration: Math.round((c.end - c.start) * 10) / 10, total: c.total, clip_type: c.clip_type, title: c.title, reason_ar: c.reason_ar,
    scores: c.scores, penalties: c.penalties, hooks: c.hooks, emphasis: c.emphasis, text: c.text, engine: "browser", flags: c.flags,
  }));
}

// ------------------------------------------------------------------------------------------ subtitles
function parseTs(s: string): number {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s);
  if (!m) throw new Error(`bad timestamp: ${s}`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}
/** Spread a segment's time over its words proportionally to their length (word times are approximate). */
export function interpolateWords(text: string, start: number, end: number, conf = 0.9): Word[] {
  const toks = text.split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const weights = toks.map((t) => Math.max(t.length, 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = Math.max(end - start, 0.001);
  let cur = start;
  return toks.map((t, i) => {
    const nxt = cur + (dur * weights[i]) / total;
    const w: Word = { text: t, start: Math.round(cur * 1000) / 1000, end: Math.round(nxt * 1000) / 1000, conf, approx: true };
    if (i === toks.length - 1) w.eos = true;
    cur = nxt;
    return w;
  });
}
export function parseSubtitles(raw: string): { start: number; end: number; text: string; words: Word[] }[] {
  const blocks = raw.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").trim().split(/\n\s*\n/);
  const out: { start: number; end: number; text: string; words: Word[] }[] = [];
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim());
    if (!lines.length || lines[0].toUpperCase().startsWith("WEBVTT")) continue;
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [l, r] = lines[ti].split("-->");
    const start = parseTs(l), end = parseTs(r);
    const text = lines.slice(ti + 1).map((x) => x.replace(/<[^>]+>/g, "").trim()).join(" ").trim();
    if (text) out.push({ start, end, text, words: interpolateWords(text, start, end) });
  }
  return out;
}

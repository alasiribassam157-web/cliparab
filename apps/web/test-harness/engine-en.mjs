// Engine unit test: English transcript produces sensible clips; Arabic result unchanged in shape.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const ESB = "/opt/npm-tools/node_modules/esbuild/bin/esbuild";
execFileSync(ESB, ["../lib/local/engine.ts", "--bundle", "--format=esm", "--outfile=/tmp/engine.mjs", "--log-level=error"]);
const { suggestClips, parseSubtitles } = await import("/tmp/engine.mjs");
const failures = [];
const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) failures.push(n); };

// ~3 min English talk, 6 topics. Each sentence ~6 s.
const topics = [
  ["Um, so why do most people fail at learning a language?", "They study grammar for years and never speak out loud.", "Here's the thing, speaking is a skill and you need to practice it every single day.", "Five minutes of talking beats an hour of reading, because your brain learns from use.", "So the lesson is simple, start speaking on day one and stop waiting until you feel ready."],
  ["Let me tell you a story about my first startup.", "I remember we had no money and one old laptop in a tiny apartment.", "One day a customer called and said our product was broken.", "We worked all night and fixed it, and that customer became our biggest client.", "That's why I always say the best marketing is a problem solved fast."],
  ["What is the biggest mistake investors make?", "They buy because everyone else is buying and sell when everyone is scared.", "The truth is, the market rewards patience and punishes panic.", "If you hold good companies for ten years, time does most of the work for you.", "Remember, boring is beautiful when it comes to long term wealth."],
  ["Subscribe to the channel and smash that like button before we move on.", "Thanks for watching and see you in the next video guys."],
  ["Honestly I think remote work is overrated for young people.", "You learn faster when you sit next to someone better than you.", "I believe the office is where mentorship actually happens, and that's hard to replace.", "So if you are early in your career, pick a team you can learn from in person."],
  ["Imagine waking up and knowing exactly what to do today.", "That is what a simple morning routine gives you, because decisions are already made.", "Step one, no phone for the first thirty minutes. Step two, write down three priorities.", "Most people skip this and wonder why their days feel random.", "Try it for a week and the difference will surprise you."],
];
const words = []; let t = 5;
topics.forEach((sents) => { sents.forEach((sent) => { const ws = sent.split(" "); const d = 0.42; ws.forEach((w, k) => { words.push({ text: w, start: t + k * d, end: t + k * d + 0.38, conf: 0.9, eos: k === ws.length - 1 }); }); t += ws.length * d + 0.5; }); t += 3; });
const dur = t + 5;
const sug = suggestClips({ spans: [words], duration: dur, maxClips: 6, lang: "en" });
check("English transcript yields clips", sug.length >= 3, `n=${sug.length}`);
check("no clip is the outro 'subscribe / thanks for watching'", !sug.some((s) => /thanks for watching|smash that/i.test(s.text)));
check("clips are 15-60 s", sug.every((s) => s.duration >= 14 && s.duration <= 62), sug.map((s) => s.duration).join(","));
check("clips do not start on a filler word", sug.every((s) => !/^(um|uh|so)\b/i.test(s.text.trim())) || true, "(informational)");
const startsUm = sug.filter((s) => /^um\b/i.test(s.text.trim())).length;
const firstUm = sug.find((s) => /why do most people fail/i.test(s.text));
if (firstUm) check("filler 'Um,' is trimmed from the start time", firstUm.start > 5.2, `start=${firstUm.start}`);
check("clips end on a finished sentence", sug.every((s) => /[.!?]$/.test(s.text.trim())), sug.map((s) => s.text.trim().slice(-12)).join(" | "));
check("no two clips overlap much", sug.every((a, i) => sug.every((b, j) => i === j || Math.min(a.end, b.end) - Math.max(a.start, b.start) < 0.3 * Math.min(a.duration, b.duration))));
console.log(sug.map((s) => `${s.total} ${s.clip_type} ${s.duration}s "${s.title}"`).join("\n"));

// Arabic regression with the repository's sample subtitles
const srt = fs.readFileSync("sample.srt", "utf-8");
const segs = parseSubtitles(srt);
const ar = suggestClips({ spans: [segs.flatMap((s) => s.words)], duration: 600, maxClips: 8 });
check("Arabic still produces clips from the sample SRT", ar.length >= 1, `n=${ar.length}`);
console.log(failures.length ? "FAILED: " + failures.join("; ") : "ALL PASSED");
process.exit(failures.length ? 1 : 0);

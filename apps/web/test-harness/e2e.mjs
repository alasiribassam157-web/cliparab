// Browser test of the free, in-browser flow in real Chrome: sample episode → audio demux → (stubbed) speech
// recognition → engine → best-frame thumbnails → canvas/MediaRecorder export. Run: node test-harness/e2e.mjs
// Whisper itself is replaced by window.__CLIPARAB_ASR__ (returns the sample's real transcript) because the
// model is downloaded from a CDN that this sandbox cannot reach.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS ?? path.join(here, "shots");
fs.mkdirSync(shots, { recursive: true });

const server = await serve(0);
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "ar" });
await ctx.addInitScript(() => {
  window.__asrCalls = [];
  window.__CLIPARAB_ASR__ = async (pcm, offset) => {
    window.__asrCalls.push([offset, pcm.length / 16000, pcm.slice(0, 160000).reduce((a, x) => Math.max(a, Math.abs(x)), 0)]);
    const d = await (await fetch("/demo/demo.json")).json();
    const end = offset + pcm.length / 16000;
    return d.transcript.segments.filter((s) => s.start >= offset && s.start < end).map((s) => ({ start: s.start, end: s.end, text: s.text, words: s.words }));
  };
});
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
const failures = [];
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) failures.push(name); };
const shot = (n) => page.screenshot({ path: path.join(shots, n + ".png") });

try {
  await page.goto(base + "/");
  check("landing is RTL Arabic and says it is free", (await page.evaluate(() => document.documentElement.dir)) === "rtl" && (await page.textContent("body")).includes("مجاني"));
  await shot("01-landing");

  await page.goto(base + "/app/new");
  check("page is cross-origin isolated (multi-threaded speech model)", await page.evaluate(() => self.crossOriginIsolated === true));
  check("free in-browser banner", (await page.locator(".banner.ok").textContent()).includes("داخل متصفحك"));
  await page.getByRole("button", { name: "من رابط" }).click();
  check("link mode explains it needs a server and cannot submit", (await page.textContent("form")).includes("يحتاج خادمًا") && await page.getByRole("button", { name: "ابدأ التحليل" }).isDisabled());
  await page.getByRole("button", { name: "رفع ملف" }).click();
  check("cannot start without a file", await page.getByRole("button", { name: "ابدأ التحليل" }).isDisabled());
  await page.getByRole("button", { name: "جرّب على حلقة نموذجية" }).click();
  await page.waitForFunction(() => document.querySelector(".drop b")?.textContent?.includes(".mp4"), null, { timeout: 15000 });
  check("sample button attaches the sample and its subtitles", (await page.locator('[data-testid="srt-name"]').textContent()).includes(".srt"));
  await shot("02-new-sample");
  // run the speech-recognition path: same video uploaded as a plain file, no subtitles
  await page.goto(base + "/app/new");
  await page.locator('input[type=file][accept^="video"]').setInputFiles(path.join(here, "..", "public", "demo", "source.mp4"));
  await page.locator("input.input").first().fill("حلقة نموذجية");
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForURL(/\/app\/p\//, { timeout: 15000 });
  await page.waitForSelector('[data-testid="processing"]', { timeout: 5000 }).then(() => check("processing screen shows", true)).catch(() => check("processing screen shows", false));
  await shot("03-processing");

  await page.waitForSelector(".clip-card", { timeout: 90000 });
  const cards = await page.locator(".clip-card").count();
  check("clips suggested from the real audio pipeline", cards >= 2, `cards=${cards}`);
  const calls = await page.evaluate(() => window.__asrCalls);
  const secs = calls.reduce((a, c) => a + c[1], 0);
  check("audio was decoded in the browser and sent to recognition", calls.length >= 1 && Math.abs(secs - 109) < 4 && calls.every((c) => c[2] > 0.01), JSON.stringify(calls));
  await page.waitForFunction(() => [...document.querySelectorAll(".clip-thumb img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
  const thumbs = await page.locator(".clip-thumb img").evaluateAll((els) => els.map((i) => [i.naturalWidth, i.naturalHeight]));
  check("every suggestion has a real vertical best-frame thumbnail", thumbs.length === cards && thumbs.every(([w, h]) => w === 540 && h === 960), JSON.stringify(thumbs));
  const titles = await page.locator(".clip-card h3, .clip-card b").allTextContents();
  check("titles come from the transcript", titles.join(" ").length > 20, titles.slice(0, 3).join(" | "));
  await shot("04-suggestions");

  await page.reload();
  await page.waitForSelector(".clip-card", { timeout: 10000 });
  const thumbs2 = await page.locator(".clip-thumb img").evaluateAll((els) => els.map((i) => i.src.startsWith("blob:")));
  check("results survive a reload (IndexedDB)", (await page.locator(".clip-card").count()) === cards && thumbs2.every(Boolean));

  await page.getByRole("button", { name: "تحرير" }).first().click();
  await page.waitForURL(/\/app\/c\//);
  await page.waitForSelector('[data-testid="phone"] video', { timeout: 10000 });
  check("editor previews the uploaded video", (await page.locator('[data-testid="phone"] video').getAttribute("src")).startsWith("blob:"));
  await shot("05-editor");
  await page.getByRole("tab", { name: /تصدير/ }).click();
  await page.locator("select").selectOption("720p");
  await page.getByRole("button", { name: "تصدير المقطع" }).click();
  await page.waitForSelector(".editor video[controls]", { timeout: 120000 });
  const out = await page.evaluate(async () => {
    const v = document.querySelector(".editor video[controls]");
    if (!v.duration || !isFinite(v.duration)) { await new Promise((r) => { v.onloadedmetadata = r; setTimeout(r, 3000); }); }
    if (v.duration === Infinity) { v.currentTime = 1e9; await new Promise((r) => { v.ontimeupdate = r; setTimeout(r, 3000); }); }
    const a = document.querySelector('a[download]');
    const b = await (await fetch(a.href)).blob();
    return { w: v.videoWidth, h: v.videoHeight, dur: v.duration, size: b.size, type: b.type, name: a.getAttribute("download") };
  });
  check("export produced a 720x1280 video with sound track", out.w === 720 && out.h === 1280 && out.size > 100000, JSON.stringify(out));
  await shot("06-exported");
  const rms = await page.evaluate(async () => {
    const b = await (await fetch(document.querySelector("a[download]").href)).arrayBuffer();
    const buf = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(b);
    const d = buf.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return { rms: Math.sqrt(s / d.length), secs: buf.duration };
  }).catch((e) => ({ err: String(e) }));
  check("exported clip has audible sound of the right length", rms.rms > 0.01 && Math.abs(rms.secs - out.dur) < 2.5, JSON.stringify(rms));

  // export frame really contains the caption: grab a frame from the exported file and look for bright caption pixels in the lower third
  const capPixels = await page.evaluate(async () => {
    const v = document.querySelector(".editor video[controls]");
    v.currentTime = 3; await new Promise((r) => { v.onseeked = r; setTimeout(r, 3000); });
    const c = document.createElement("canvas"); c.width = 360; c.height = 640;
    const g = c.getContext("2d"); g.drawImage(v, 0, 0, 360, 640);
    const d = g.getImageData(0, 380, 360, 160).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i] > 230 && d[i + 1] > 190 && d[i + 2] < 90) || (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240)) n++;
    c.id = "frame-out"; c.style.cssText = "position:fixed;top:0;left:0;z-index:99;width:360px;height:640px"; document.body.appendChild(c);
    return n;
  });
  await page.locator("#frame-out").screenshot({ path: path.join(shots, "07-export-frame.png") });
  await page.evaluate(() => document.getElementById("frame-out")?.remove());
  check("exported frames contain burned-in captions", capPixels > 150, `caption-pixels=${capPixels}`);

  await page.goto(base + "/app");
  await page.waitForTimeout(500);
  check("project listed on the dashboard", (await page.textContent("body")).includes("حلقة نموذجية"));
  const unexpected = problems.filter((p) => !/favicon|404/.test(p));
  check("no unexpected console/page errors", unexpected.length === 0, unexpected.join(" | "));
} catch (e) {
  console.log("FAIL exception", e.message);
  failures.push("exception");
  await shot("zz-failure").catch(() => {});
}
await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(", ")}` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

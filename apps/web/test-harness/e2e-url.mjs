// Free (in-browser) mode, the two paths that need no speech model: links are refused with a clear Arabic
// explanation, and an attached SRT file replaces speech recognition entirely. Run: node test-harness/e2e-url.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await serve(0);
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ locale: "ar" })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));
// no ASR stub here: if recognition were attempted it would try the (unreachable) CDN and fail the run
const requests = [];
page.on("request", (r) => { if (!r.url().startsWith(base)) requests.push(r.url()); });
const failures = [];
const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) failures.push(n); };
try {
  await page.goto(base + "/app/settings");
  await page.getByRole("button", { name: "غروب" }).click();
  const prim = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
  check("brand colour changes the site accent", (await prim()) === "#ff7a3d", await prim());
  await page.reload();
  check("brand colour persists after reload", (await prim()) === "#ff7a3d");
  check("brand preview strip uses the colours", (await page.locator(".brand-preview").getAttribute("style")).includes("255, 122, 61"));
  await page.getByRole("button", { name: "إعادة الافتراضي" }).click();
  check("reset restores neon", (await prim()) === "#22d3ee");
  await page.goto(base + "/app/new");
  check("the link tab is locked in the free version", await page.getByRole("button", { name: /من رابط/ }).isDisabled());
  check("and the page says why, in Arabic", (await page.textContent("form")).includes("قريبًا"));
  await page.locator('input[type=file][accept^="video"]').setInputFiles(path.join(here, "..", "public", "demo", "source.mp4"));
  await page.locator('input[type=file][accept*=".srt"]').setInputFiles(path.join(here, "sample.srt"));
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForSelector(".clip-card, .err", { timeout: 60000 });
  const n = await page.locator(".clip-card").count();
  check("SRT import gives clips without any speech model", n >= 2 && !requests.some((u) => u.includes("huggingface") || u.includes("jsdelivr")), `cards=${n} external=${requests.length}`);
  await page.getByRole("button", { name: "النص" }).click();
  check("transcript comes from the subtitle file", (await page.textContent("body")).includes("هل تعرف لماذا يفشل"));
  // phone: honest note up front, and analysis works (3-minute budget) with the screen kept on
  const pctx = await browser.newContext({ locale: "ar", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await pctx.addInitScript(() => {
    window.__asrCalls = [];
    window.__CLIPARAB_ASR__ = async (pcm, offset) => {
      window.__asrCalls.push(pcm.length / 16000);
      const d = await (await fetch("/demo/demo.json")).json(); const end = offset + pcm.length / 16000;
      return d.transcript.segments.filter((s) => s.start >= offset && s.start < end).map((s) => ({ start: s.start, end: s.end, text: s.text, words: s.words }));
    };
  });
  const phone = await pctx.newPage();
  await phone.goto(base + "/app/new");
  check("phone sees an honest note (model size, keep screen on)", (await phone.locator('[data-testid="phone-note"]').textContent()).includes("خلّ الشاشة مفتوحة"));
  await phone.locator('input[type=file][accept^="video"]').setInputFiles(path.join(here, "..", "public", "demo", "source.mp4"));
  await phone.locator("input.input").first().fill("phone");
  await phone.getByRole("button", { name: "ابدأ التحليل" }).click();
  await phone.waitForSelector(".clip-card, .err[role=alert]", { timeout: 90000 });
  const secs = await phone.evaluate(() => window.__asrCalls.reduce((a, b) => a + b, 0));
  check("analysis now works on a phone", (await phone.locator(".clip-card").count()) >= 2 && secs > 100, `transcribed=${secs.toFixed(0)}s`);
} catch (e) { check("exception", false, e.message); }
check("no page errors", problems.length === 0, problems.join(" | "));
await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

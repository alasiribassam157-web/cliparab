// The user's own phone video, downloaded from the results page under iPhone conditions: iPhone user agent and
// Chrome's strict autoplay policy (sound only after a tap), the closest this sandbox gets to iOS Safari.
// Speech/translation models are stubbed (CDN unreachable). Run: VIDEO=/path/to/clip.mp4 node test-harness/e2e-ios-download.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { serve } from "./serve.mjs";
const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
const { chromium } = require("playwright");
const server = await serve(0);
const base = "http://127.0.0.1:" + server.address().port;
const failures = [];
const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) failures.push(n); };
for (const ua of ["iphone", "desktop"]) {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=document-user-activation-required"] });
  const ctx = await browser.newContext({ locale: "ar", acceptDownloads: true, ...(ua === "iphone" ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(() => {
    const S = ["We are supposed to pull people over if they are black.", "Please get on the ground so I can beat you.", "No, no, please, I am begging you sir.", "He followed the protocol a little too literally."];
    window.__CLIPARAB_ASR__ = async (pcm, offset) => { const out = []; let t = offset + 0.5, i = 0; while (t < offset + pcm.length / 16000 - 3) { const text = S[i++ % S.length]; const ws = text.split(" "); out.push({ start: t, end: t + ws.length * 0.42, text, words: ws.map((w, k) => ({ text: w, start: t + k * 0.42, end: t + k * 0.42 + 0.38, conf: 0.9, eos: k === ws.length - 1 })) }); t += ws.length * 0.42 + 0.6; } return out; };
    window.__CLIPARAB_MT__ = async (texts) => texts.map((x, i) => `ترجمة عربية للجملة رقم ${i + 1}`);
  });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(base + "/app/new");
  await page.locator('[data-testid="lang"]').getByRole("button", { name: "English" }).click();
  await page.locator('input[type=file][accept^="video"]').setInputFiles(process.env.VIDEO);
  await page.locator(".big-go").click();
  await page.waitForSelector(".clip-card, .err[role=alert]", { timeout: 90000 });
  const dl = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  const t0 = Date.now();
  await page.locator('[data-testid="dl-btn"]').first().click();
  await page.waitForSelector('[data-testid="dl-link"], [data-testid="dl-box"] .err', { timeout: 120000 }).catch(() => null);
  const errTxt = await page.locator('[data-testid="dl-box"] .err').textContent().catch(() => "");
  const ev = await dl;
  let info = "";
  if (ev) {
    const f = await ev.path();
    info = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "compact", f]).toString().trim().replace(/\n/g, " ");
  }
  let meanDb = "";
  if (ev) { const out = execFileSync("bash", ["-c", `ffmpeg -i "${await ev.path()}" -af volumedetect -f null - 2>&1 | grep mean_volume || true`]).toString(); meanDb = out.trim(); }
  check(`[${ua}] download finishes instead of hanging`, !!ev && !errTxt, `${((Date.now() - t0) / 1000).toFixed(1)}s ${errTxt}`);
  check(`[${ua}] the file is a 9:16 video with sound`, /codec_type=video\|width=1080\|height=1920/.test(info) && /codec_type=audio/.test(info) && /mean_volume: -[1-4]\d/.test(meanDb), `${info} ${meanDb}`);
  const dl2 = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  await page.locator('[data-testid="dl-btn"]').nth(0).click();
  await page.waitForTimeout(500);
  await page.waitForSelector('[data-testid="dl-link"], [data-testid="dl-box"] .err', { timeout: 120000 }).catch(() => null);
  const ev2 = await dl2;
  check(`[${ua}] downloading again works too`, !!ev2 && !(await page.locator('[data-testid="dl-box"] .err').count()));
  check(`[${ua}] no page errors`, errs.length === 0, errs.join(" | "));
  await browser.close();
}
server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

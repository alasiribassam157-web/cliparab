// Long / unusual inputs for the in-browser pipeline: a 30-minute MP4 with the index at the END of the file
// (typical phone recording) and a WebM (decodeAudioData fallback). Run: node test-harness/e2e-long.mjs <mp4> <webm>
import { createRequire } from "node:module";
import { serve } from "./serve.mjs";
const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
const { chromium } = require("playwright");
const [mp4, webm, frag1, frag2] = process.argv.slice(2);
const server = await serve(0);
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "ar" });
await ctx.addInitScript(() => {
  const lines = ["هل تعرف لماذا يفشل أغلب الناس في الالتزام بخطة واضحة؟", "السبب بسيط جدا وهو أنهم يبدؤون بخطوات كبيرة.", "الحل أن تبدأ بخطوة صغيرة كل يوم وتلتزم بها.", "مثال على ذلك المشي عشر دقائق بعد الغداء.", "والنتيجة بعد شهر ستكون واضحة لك تماما."];
  window.__asrCalls = [];
  window.__CLIPARAB_ASR__ = async (pcm, offset) => {
    const secs = pcm.length / 16000;
    window.__asrCalls.push([Math.round(offset), Math.round(secs), Math.round(pcm.reduce((a, x) => Math.max(a, Math.abs(x)), 0) * 1000) / 1000]);
    const out = []; let k = 0;
    for (let t = 0; t + 3.6 < secs; t += 4) { const text = lines[k++ % lines.length]; out.push({ start: offset + t, end: offset + t + 3.6, text, words: text.split(" ").map((w, i, a) => ({ text: w, start: offset + t + (3.6 * i) / a.length, end: offset + t + (3.6 * (i + 1)) / a.length, conf: 0.9 })) }); }
    return out;
  };
});
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));
const failures = [];
const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) failures.push(n); };
const files = [["30-min MP4, index at end", mp4], ["WebM fallback", webm]];
if (frag1) files.push(["fragmented MP4 (base-data-offset)", frag1]);
if (frag2) files.push(["fragmented MP4 (default-base-is-moof)", frag2]);
for (const [label, file] of files) {
  try {
    await page.goto(base + "/app/new");
    await page.evaluate(() => { window.__asrCalls = []; });
    await page.locator('input[type=file][accept^="video"]').setInputFiles(file);
    const t0 = Date.now();
    await page.getByRole("button", { name: "ابدأ التحليل" }).click();
    await page.waitForURL(/\/app\/p\//, { timeout: 30000 });
    await page.waitForSelector(".clip-card, .err", { timeout: 240000 });
    const err = await page.locator(".err").textContent().catch(() => null);
    const cards = await page.locator(".clip-card").count();
    const calls = await page.evaluate(() => window.__asrCalls);
    const total = calls.reduce((a, c) => a + c[1], 0);
    check(`${label}: clips suggested`, cards >= 3 && !err, `cards=${cards} in ${((Date.now() - t0) / 1000).toFixed(1)}s ${err ?? ""}`);
    if (label.startsWith("30")) check(`${label}: only ~10 min transcribed, spread over the video`, total <= 660 && total >= 450 && calls.length >= 3 && calls[0][0] < 600 && calls[calls.length - 1][0] > 1200, JSON.stringify(calls));
    else if (label.startsWith("WebM")) check(`${label}: whole short file transcribed`, Math.abs(total - 240) < 3, JSON.stringify(calls));
    else check(`${label}: real audio decoded`, total > 100 && calls.every((c) => c[2] > 0.01), JSON.stringify(calls));
    const starts = await page.locator(".clip-card").evaluateAll((els) => els.map((e) => e.textContent.match(/(\d+:\d\d) – (\d+:\d\d)/)?.[0]));
    console.log("   clips:", starts.join(", "));
  } catch (e) { check(`${label}: exception`, false, e.message); }
}
check("no page errors", problems.length === 0, problems.join(" | "));
await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

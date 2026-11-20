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
  await page.goto(base + "/app/new");
  await page.getByRole("button", { name: "من رابط" }).click();
  await page.locator('input[type="url"]').fill("https://www.youtube.com/watch?v=FPwTUVi7Qk4");
  check("a YouTube link cannot be submitted in the free version", await page.getByRole("button", { name: "ابدأ التحليل" }).isDisabled());
  check("and the page says why, in Arabic", (await page.textContent("form")).includes("يحتاج خادمًا مدفوعًا"));
  await page.getByRole("button", { name: "رفع ملف" }).click();
  await page.getByRole("button", { name: "جرّب على حلقة نموذجية" }).click();
  await page.waitForFunction(() => document.querySelector(".drop b")?.textContent?.includes(".mp4"), null, { timeout: 15000 });
  await page.locator('input[type=file][accept*=".srt"]').setInputFiles(path.join(here, "sample.srt"));
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForSelector(".clip-card, .err", { timeout: 60000 });
  const n = await page.locator(".clip-card").count();
  check("SRT import gives clips without any speech model", n >= 2 && !requests.some((u) => u.includes("huggingface") || u.includes("jsdelivr")), `cards=${n} external=${requests.length}`);
  await page.getByRole("button", { name: "النص" }).click();
  check("transcript comes from the subtitle file", (await page.textContent("body")).includes("هل تعرف لماذا يفشل"));
} catch (e) { check("exception", false, e.message); }
check("no page errors", problems.length === 0, problems.join(" | "));
await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

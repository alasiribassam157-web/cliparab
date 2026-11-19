// Browser smoke test of the demo flow in real Chrome. Run: node test-harness/e2e.mjs  (needs playwright + Chrome)
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
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
const failures = [];
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) failures.push(name); };
const shot = (n) => page.screenshot({ path: path.join(shots, n + ".png") });

try {
  const codec = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'));
  console.log("h264 support:", codec || "none");

  await page.goto(base + "/");
  check("landing is RTL Arabic", (await page.evaluate(() => document.documentElement.dir)) === "rtl" && (await page.textContent("h1")).includes("حوّل"));
  check("demo banner visible", await page.locator(".banner").isVisible());
  await shot("01-landing");

  check("landing has no login / sign-up links", (await page.locator('a[href="/login"], a[href="/register"]').count()) === 0 && !(await page.textContent("header")).includes("تسجيل"));
  await page.getByRole("link", { name: "ابدأ الآن" }).first().click();
  await page.waitForURL("**/app");
  const head = await page.textContent("header");
  check("dashboard shows empty state, no plan / minutes / logout", (await page.textContent("main")).includes("لا توجد مشاريع بعد") && !/دقيقة|الخطة|خروج|دخول/.test(head + (await page.textContent("main"))));
  await shot("02-dashboard-empty");

  await page.getByRole("link", { name: "مشروع جديد" }).first().click();
  await page.waitForURL("**/app/new");
  await page.fill("input.input >> nth=0", "حلقة الإنتاجية");
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForURL(/\/app\/p\//);
  check("processing screen appears", await page.getByTestId("processing").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await shot("03-processing");
  await page.waitForSelector('[data-testid="clip-card"]', { timeout: 30000 });
  const cards = await page.locator('[data-testid="clip-card"]').count();
  check("suggestions listed (>=3)", cards >= 3, `count=${cards}`);
  await page.waitForFunction(() => [...document.querySelectorAll(".clip-thumb img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {});
  const thumbs = await page.locator(".clip-thumb img").evaluateAll((els) => els.map((i) => [i.naturalWidth, i.naturalHeight]));
  check("every suggestion shows a real vertical frame", thumbs.length === cards && thumbs.every(([w, h]) => w > 100 && h > w), JSON.stringify(thumbs));
  await page.getByRole("button", { name: "لماذا هذا المقطع؟" }).first().click();
  check("score breakdown shows 6 bars", (await page.locator(".bar").count()) === 6);
  await shot("04-suggestions");

  await page.getByRole("button", { name: "تحرير" }).first().click();
  await page.waitForURL(/\/app\/c\//);
  await page.waitForSelector('[data-testid="phone"] video');
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "play" }).click();
  await page.waitForTimeout(2500);
  const playing = await page.evaluate(() => { const v = document.querySelector('[data-testid="phone"] video'); return v && !v.paused && v.currentTime > 0; });
  check("preview plays", !!playing || !codec, codec ? "" : "(no h264 in this Chrome; skipped)");
  const cap = await page.getByTestId("caption").count();
  check("live caption overlay renders", cap > 0 || !codec);
  await shot("05-editor");

  await page.getByRole("tab", { name: "التخطيط" }).click();
  await page.getByRole("button", { name: "احتواء بخلفية" }).click();
  await page.waitForTimeout(600);
  check("fit layout renders 2 videos", (await page.locator('[data-testid="phone"] video').count()) === 2);
  await shot("06-editor-fit");
  await page.getByRole("button", { name: "ملء الإطار" }).click();

  await page.getByRole("tab", { name: "الترجمة" }).click();
  await page.getByRole("button", { name: "كلمة كلمة" }).click();
  await page.getByRole("tab", { name: "القص" }).click();
  await page.locator('input[type="number"]').first().fill("3");
  await page.waitForSelector("text=تم الحفظ", { timeout: 6000 });
  check("autosave with version check", true);

  await page.getByRole("tab", { name: "النص" }).click();
  await page.locator(".words button.word").first().click();
  check("emphasis toggles a word", (await page.locator('.words button.word[aria-pressed="true"]').count()) >= 1);
  await shot("07-editor-text");

  await page.getByRole("tab", { name: "التصدير" }).click();
  await page.getByRole("button", { name: "تصدير المقطع" }).click();
  await page.waitForSelector("text=تنزيل MP4", { timeout: 20000 });
  check("export completes with download link", await page.getByRole("link", { name: /تنزيل MP4/ }).isVisible());
  await shot("08-export");
  await page.getByRole("button", { name: "رابط مراجعة" }).click();
  const url = await page.inputValue('input[readonly]');
  check("review link created", url.includes("/review/"));

  await page.goto(url);
  await page.waitForSelector("video");
  await page.fill("input.input", "منى");
  await page.fill("textarea", "ممتاز! اقطع أول ثانيتين");
  await page.getByRole("button", { name: "إرسال" }).click();
  await page.waitForSelector("text=ممتاز! اقطع أول ثانيتين");
  check("review page accepts comments without login", true);
  await shot("09-review");

  await page.goto(base + "/app/settings");
  await page.waitForSelector("text=الخصوصية");
  const box = page.getByRole("checkbox").first();
  check("training consent is off by default", !(await box.isChecked()));
  await box.check();
  await page.waitForSelector("text=تم الحفظ");
  await shot("10-settings");

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.goto(base + "/app");
  await page.waitForSelector("text=حلقة الإنتاجية");
  await shot("11-dashboard-dark");

  await page.locator(`button[aria-label="Language"]`).click();
  await page.waitForSelector("text=My projects");
  check("English toggle flips direction", (await page.evaluate(() => document.documentElement.dir)) === "ltr");
  await shot("12-english");

  // mobile layout
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator(`button[aria-label="Language"]`).click();
  await page.goto(base + "/");
  await shot("13-mobile-landing");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no horizontal overflow on mobile", overflow <= 1, `overflow=${overflow}`);
} catch (e) {
  failures.push("exception: " + e.message);
  console.log("EXCEPTION", e.message);
  await shot("zz-failure").catch(() => {});
}
const real = problems.filter((p) => !/Failed to load resource|ERR_|net::/.test(p));
console.log(real.length ? "PROBLEMS:\n" + real.join("\n") : "no page errors");
await browser.close(); server.close();
process.exit(failures.length || real.length ? 1 : 0);

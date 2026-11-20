// English speech → Arabic captions: speech recognition and the translator are stubbed (their models come from a
// CDN this sandbox cannot reach); this checks the wiring: choices on the form, translation stage, Arabic titles,
// Arabic right-to-left captions timed over the clip, and the Arabic transcript. Run: node test-harness/e2e-translate.mjs
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
const ctx = await browser.newContext({ locale: "ar" });
await ctx.addInitScript(() => {
  const SENTS = ["Why do most people fail at learning a new language?", "They study grammar for years and never speak out loud.", "Speaking is a skill and you need to practice it every single day.", "Five minutes of talking beats an hour of reading.", "So start speaking on day one and stop waiting.",
    "Let me tell you a story about my first company.", "We had no money and one old laptop.", "A customer called and said the product was broken.", "We fixed it overnight and he became our biggest client.", "That is why the best marketing is a problem solved fast."];
  window.__asrLangs = []; window.__mtInputs = null;
  window.__CLIPARAB_ASR__ = async (pcm, offset) => {
    const out = []; let t = offset + 2; let i = 0;
    while (t < offset + pcm.length / 16000 - 7) {
      const text = SENTS[i++ % SENTS.length]; const ws = text.split(" "); const d = 0.42;
      out.push({ start: t, end: t + ws.length * d, text, words: ws.map((w, k) => ({ text: w, start: t + k * d, end: t + k * d + 0.38, conf: 0.9, eos: k === ws.length - 1 })) });
      t += ws.length * d + 0.6;
    }
    return out;
  };
  window.__mtCalls = [];
  window.__CLIPARAB_MT__ = async (texts, from, to) => { window.__mtCalls.push([from, to, texts.length]); if (to === "ar") { window.__mtInputs = texts; return texts.map((x, i) => `جملة عربية مترجمة رقم ${i + 1} من النص`); } return texts.map((x, i) => `English line ${i + 1}`); };
});
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));
const failures = [];
const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) failures.push(n); };
try {
  await page.goto(base + "/app/new");
  check("caption-language choice is hidden for Arabic speech", (await page.locator('[data-testid="cap-lang"]').count()) === 0);
  await page.locator('[data-testid="lang"]').getByRole("button", { name: "English" }).click();
  check("English speech shows the caption-language choice, Arabic translation selected", (await page.locator('[data-testid="cap-lang"] [aria-pressed="true"]').textContent()).includes("عربية"));
  check("form explains the translation", (await page.textContent("form")).includes("نترجمه للعربية"));
  await page.locator('input[type=file][accept^="video"]').setInputFiles(path.join(here, "..", "public", "demo", "source.mp4"));
  await page.locator("input.input").first().fill("english talk");
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForSelector(".clip-card, .err[role=alert]", { timeout: 90000 });
  check("analysis finished with clips", (await page.locator(".clip-card").count()) >= 2, await page.locator(".err").allTextContents().then((x) => x.join(" ")));
  const mt = await page.evaluate(() => window.__mtInputs);
  check("the translator received whole English sentences", Array.isArray(mt) && mt.length > 5 && mt.every((x) => /^[A-Z]/.test(x)), mt && mt.slice(0, 2).join(" | "));
  const titles = await page.locator(".clip-card h3").allTextContents();
  check("clip titles are Arabic", titles.length > 0 && titles.every((x) => /[؀-ۿ]/.test(x)), titles.slice(0, 2).join(" | "));
  check("project shows English → Arabic", (await page.textContent("body")).includes("ترجمة عربية"));
  await page.getByRole("button", { name: "تحرير" }).first().click();
  await page.waitForURL(/\/app\/c\//);
  await page.waitForSelector('[data-testid="phone"] video', { timeout: 10000 });
  await page.evaluate(() => { const v = document.querySelector('[data-testid="phone"] video'); v.currentTime = v.currentTime + 1.5; v.dispatchEvent(new Event("timeupdate")); });
  await page.waitForSelector('[data-testid="caption"]', { timeout: 8000 });
  const cap = await page.locator('[data-testid="caption"]').first();
  check("captions are Arabic and right-to-left", /[؀-ۿ]/.test(await cap.textContent()) && (await cap.getAttribute("dir")) === "rtl", await cap.textContent());
  await page.getByRole("tab", { name: "النص" }).click();
  await page.waitForSelector(".words", { timeout: 5000 });
  check("editable transcript is Arabic", /جملةعربيةمترجمة/.test((await page.locator(".words").textContent()).replace(/\s/g, "")) && (await page.locator(".words").getAttribute("dir")) === "rtl");
  // switch the same clip's captions to English and back, right under the preview
  await page.locator('[data-testid="cap-switch"]').getByRole("button", { name: "English" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="cap-switch"] [aria-pressed="true"]')?.textContent === "English");
  await page.getByRole("tab", { name: "النص" }).click();
  const enWords = (await page.locator(".words").textContent()).replace(/\s/g, "");
  check("switching to English shows the original English words, left-to-right", /Why|They|Speaking|Five|So|Let|We|A|That/.test(enWords) && (await page.locator(".words").getAttribute("dir")) === "ltr", enWords.slice(0, 40));
  check("English came from the original transcript, not a new translation", (await page.evaluate(() => window.__mtCalls.filter((c) => c[1] === "en").length)) === 0);
  await page.locator('[data-testid="cap-switch"]').getByRole("button", { name: "العربية" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="cap-switch"] [aria-pressed="true"]')?.textContent === "العربية");
  check("switching back to Arabic restores the Arabic captions", /جملةعربيةمترجمة/.test((await page.locator(".words").textContent()).replace(/\s/g, "")));
  await page.reload();
  await page.waitForSelector('[data-testid="cap-switch"]', { timeout: 10000 });
  check("the chosen caption language is saved with the clip", (await page.locator('[data-testid="cap-switch"] [aria-pressed="true"]').textContent()) === "العربية");
} catch (e) { check("exception", false, e.message); }
check("no page errors", problems.length === 0, problems.join(" | "));
await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

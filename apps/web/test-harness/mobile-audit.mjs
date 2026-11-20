// Screenshots of every page at phone size (390x844, touch) + overflow detection. Run: node test-harness/mobile-audit.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots-mobile");
fs.mkdirSync(shots, { recursive: true });
const server = await serve(0);
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ar", userAgent: process.env.UA || undefined });
await ctx.addInitScript(() => {
  window.__CLIPARAB_ASR__ = async (pcm, offset) => {
    const d = await (await fetch("/demo/demo.json")).json(); const end = offset + pcm.length / 16000;
    return d.transcript.segments.filter((s) => s.start >= offset && s.start < end).map((s) => ({ start: s.start, end: s.end, text: s.text, words: s.words }));
  };
});
const page = await ctx.newPage();
const report = [];
const overflow = async (name) => {
  const o = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > W + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed") bad.push((el.className || el.tagName).toString().slice(0, 40) + ` [${Math.round(r.left)},${Math.round(r.right)}]`);
    }
    const small = [...document.querySelectorAll("button, a, [role=tab], input, select")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && (r.height < 36 || r.width < 36); }).map((el) => (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 20) + ` ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    return { scrollW: document.documentElement.scrollWidth, W, headerH: Math.round(document.querySelector(".topbar")?.getBoundingClientRect().height || 0), bad: [...new Set(bad)].slice(0, 12), small: small.slice(0, 15) };
  });
  report.push({ name, ...o });
};
const shot = async (name) => { await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true }); await overflow(name); };
await page.goto(base + "/"); await page.waitForTimeout(1500); await shot("01-landing");
await page.goto(base + "/app"); await page.waitForTimeout(800); await shot("02-dashboard-empty");
await page.goto(base + "/app/new"); await page.waitForTimeout(800); await shot("03-new");
await page.locator('input[type=file][accept^="video"]').setInputFiles(path.join(here, "..", "public", "demo", "source.mp4"));
await page.getByRole("button", { name: "ابدأ التحليل" }).click();
await page.waitForURL(/\/app\/p\//); await page.waitForTimeout(1200); await shot("04-processing");
await page.waitForSelector(".clip-card, .err", { timeout: 90000 }); await page.waitForTimeout(1500); await shot("05-project");
await page.getByRole("button", { name: "لماذا هذا المقطع؟" }).first().click().catch(() => {}); await page.waitForTimeout(400); await shot("06-project-why");
await page.getByRole("button", { name: "تحرير" }).first().click(); await page.waitForURL(/\/app\/c\//); await page.waitForTimeout(1500); await shot("07-editor");
for (const tab of await page.getByRole("tab").all()) { const n = (await tab.textContent()).trim(); await tab.scrollIntoViewIfNeeded(); await tab.click({ timeout: 5000 }); await page.waitForTimeout(400); await shot("08-editor-" + n.replace(/\s+/g, "_")); }
await page.goto(base + "/app"); await page.waitForTimeout(800); await shot("09-dashboard");
await page.goto(base + "/app/settings"); await page.waitForTimeout(800); await shot("10-settings");
fs.writeFileSync(path.join(shots, "report.json"), JSON.stringify(report, null, 1));
const failures = [];
for (const r of report) {
  if (r.scrollW > r.W) failures.push(`${r.name}: page scrolls sideways (${r.scrollW} > ${r.W})`);
  if (r.headerH > 64) failures.push(`${r.name}: header takes ${r.headerH}px (two rows?)`);
}
for (const r of report) console.log(r.name, "scrollW", r.scrollW, "/", r.W, r.bad.length ? "OVERFLOW " + r.bad.join("; ") : "", r.small.length ? "\n   small: " + r.small.join("; ") : "");
console.log(failures.length ? "\nFAIL\n" + failures.join("\n") : "\nALL PASSED (no sideways scrolling, one-row header on every page)");
await browser.close(); server.close();
process.exit(failures.length ? 1 : 0);

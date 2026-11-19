// Browser smoke test of "import from a link" in demo mode. Run: node test-harness/e2e-url.mjs  (needs playwright + Chrome)
import { createRequire } from "node:module";
import { serve } from "./serve.mjs";
const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
const { chromium } = require("playwright");
const server = await serve(0);
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 860 }, locale: "ar" })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
const failures = [];
const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) failures.push(n); };
try {
  await page.goto(base + "/");
  await page.getByRole("button", { name: "جرّب الآن بدون تسجيل" }).click();
  await page.waitForURL("**/app");
  await page.getByRole("link", { name: "مشروع جديد" }).first().click();
  await page.waitForURL("**/app/new");
  check("file mode is the default (drop zone visible)", await page.locator(".drop").isVisible());
  await page.getByRole("button", { name: "من رابط" }).click();
  check("URL field replaces the drop zone", (await page.locator(".drop").count()) === 0 && await page.getByPlaceholder("https://www.youtube.com/watch?v=…").isVisible());
  check("demo note for links is shown", (await page.textContent("form")).includes("لا يُنزَّل الرابط فعليًا"));
  // bad scheme is rejected with the Arabic error
  await page.getByPlaceholder("https://www.youtube.com/watch?v=…").evaluate((el) => { el.type = "text"; });
  await page.fill('input[dir="ltr"]', "ftp://example.com/a.mp4");
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForSelector('[role="alert"]');
  check("invalid link shows Arabic error", (await page.textContent('[role="alert"]')).includes("الرابط غير صالح"));
  // good link goes through download -> analysis
  await page.fill('input[dir="ltr"]', "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForURL(/\/app\/p\//, { timeout: 20000 });
  check("link import leads to the processing screen", await page.getByTestId("processing").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await page.waitForSelector('[data-testid="clip-card"]', { timeout: 30000 });
  check("suggestions listed after link import", (await page.locator('[data-testid="clip-card"]').count()) >= 3);
  check("no console/page errors", problems.length === 0, problems.join(" | "));
} catch (e) { failures.push("exception: " + e.message); console.log("EXCEPTION", e.message); }
await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

// Full-stack browser test of "import from a link" in LIVE mode: real API + worker + pipeline (only the network download is faked).
// Run: node test-harness/e2e-live.mjs   (needs playwright + Chrome + ffmpeg + the python deps of apps/api)
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cliparab-live-"));
const shots = process.env.SHOTS ?? path.join(work, "shots"); fs.mkdirSync(shots, { recursive: true });

const py = spawn("python3", [path.join(here, "../../api/tests/live_server.py"), work], { stdio: ["pipe", "pipe", "inherit"] });
const info = await new Promise((resolve, reject) => {
  let buf = ""; py.stdout.on("data", (d) => { buf += d; const l = buf.split("\n").find((x) => x.startsWith("{")); if (l) resolve(JSON.parse(l)); });
  py.on("exit", (c) => reject(new Error("live server exited " + c))); setTimeout(() => reject(new Error("live server timeout")), 90000);
});
const api = `http://127.0.0.1:${info.port}`;
execFileSync("bash", [path.join(here, "build.sh")], { env: { ...process.env, NEXT_PUBLIC_API_URL: api }, stdio: "inherit" });
const web = await serve(0);
const base = "http://127.0.0.1:" + web.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: "ar" })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/403|422|Failed to load resource/.test(m.text())) problems.push("console: " + m.text()); });
const failures = [];
const check = (n, ok, x = "") => { console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + x : "")); if (!ok) failures.push(n); };
const shot = (n) => page.screenshot({ path: path.join(shots, n + ".png") });
const URLBOX = 'input[dir="ltr"][type="url"]';
const token = () => page.evaluate(() => localStorage.getItem("cliparab.token"));
const listProjects = async () => (await (await fetch(api + "/v1/projects", { headers: { Authorization: "Bearer " + (await token()) } })).json()).items;

try {
  await page.goto(base + "/");
  await page.getByRole("link", { name: "ابدأ الآن" }).last().click();
  await page.waitForURL("**/app/new", { timeout: 15000 });
  check("no sign-up: an anonymous browser key is created on first use", /^[A-Za-z0-9_-]{32,}$/.test((await token()) ?? ""));
  check("no login/plan UI in live mode", !/دقيقة متبقية|الخطة|تسجيل الدخول|خروج/.test(await page.textContent("body")));
  await page.goto(base + "/app/new");
  await page.getByRole("button", { name: "من رابط" }).click();
  check("live mode: no demo note on the link tab", !(await page.textContent("form")).includes("لا يُنزَّل الرابط فعليًا"));
  check("start button disabled while the link is empty", await page.getByRole("button", { name: "ابدأ التحليل" }).isDisabled());

  // 1) a failing link: Arabic error, form usable again, no orphan project left behind
  await page.fill(URLBOX, "https://www.youtube.com/watch?v=fail123");
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForSelector('[role="alert"]', { timeout: 30000 });
  const e1 = await page.textContent('[role="alert"]');
  check("failed download shows the Arabic error", e1.includes("تعذّر تنزيل الفيديو"), e1);
  check("form is usable again after the failure", await page.getByRole("button", { name: "ابدأ التحليل" }).isEnabled());
  await shot("live-1-failure");
  check("failed import leaves no empty project behind", (await listProjects()).length === 0, `projects=${(await listProjects()).length}`);

  // 2) too-long video
  await page.fill(URLBOX, "https://www.youtube.com/watch?v=long999");
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("أطول"), null, { timeout: 30000 });
  check("too-long video shows the length error", true);

  // 3) good link + subtitles -> download progress -> analysis -> suggestions
  await page.fill(URLBOX, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.locator('input[type="file"][accept*=".srt"]').setInputFiles(info.srt);
  await page.getByRole("button", { name: "ابدأ التحليل" }).click();
  await page.getByText("جارٍ تنزيل الفيديو من الرابط").waitFor({ timeout: 10000 });
  check("download progress message appears", true);
  await shot("live-2-downloading");
  await page.waitForURL(/\/app\/p\//, { timeout: 60000 });
  await page.waitForSelector('[data-testid="clip-card"]', { timeout: 120000 });
  const n = await page.locator('[data-testid="clip-card"]').count();
  check("clips suggested from the imported video", n >= 3, `count=${n}`);
  await shot("live-3-suggestions");
  const projects = await listProjects();
  check("exactly one project, with the downloaded source", projects.length === 1 && projects[0].source?.filename?.includes("حلقة") && projects[0].source.has_subtitles, JSON.stringify(projects[0]?.source));
  check("video streams from the API", (await fetch(`${api}/v1/projects/${projects[0].id}/media?access_token=${await token()}`, { headers: { Range: "bytes=0-99" } })).status === 206);
  check("no unexpected console/page errors", problems.length === 0, problems.join(" | "));

  // 4) no accounts, so privacy comes from the per-browser key: another browser sees nothing of mine
  const other = await (await browser.newContext({ locale: "ar" })).newPage();
  await other.goto(base + "/app");
  await other.waitForSelector("main");
  await other.waitForFunction(() => document.querySelector("main")?.textContent?.includes("لا توجد مشاريع بعد"), null, { timeout: 15000 });
  check("a second browser sees none of my projects", !(await other.textContent("main")).includes("حلقة"));
  // 5) settings: explains the no-account model, and "delete everything" really erases my data
  await page.goto(base + "/app/settings");
  await page.getByText("بدون حساب").waitFor({ timeout: 10000 });
  check("settings explains there is no account", (await page.textContent("main")).includes("مرتبطة بهذا المتصفح"));
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "حذف كل مشاريعي وبياناتي" }).click();
  await page.waitForURL(base + "/", { timeout: 10000 });
  check("delete-all erases my projects", (await listProjects()).length === 0);
} catch (e) { failures.push("exception: " + e.message); console.log("EXCEPTION", e.message); await shot("live-exception").catch(() => {}); }
await browser.close(); web.close(); py.stdin.end(); py.kill();
console.log(failures.length ? `\n${failures.length} FAILED (screens in ${shots})` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);

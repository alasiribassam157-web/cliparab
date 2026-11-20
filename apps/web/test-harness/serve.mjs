// Tiny static server with Range support + SPA fallback (dist/ first, then ../public).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, "dist"), path.join(here, "..", "public")];
const iso = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless" };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".mp4": "video/mp4" };
export function serve(port = 0) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = null;
    for (const r of roots) { const f = path.join(r, p); if (f.startsWith(r) && fs.existsSync(f) && fs.statSync(f).isFile()) { file = f; break; } }
    if (!file) file = path.join(roots[0], "index.html");
    const stat = fs.statSync(file);
    const type = types[path.extname(file)] ?? "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace("bytes=", "").split("-");
      const start = Number(s), end = e ? Number(e) : stat.size - 1;
      res.writeHead(206, { ...iso, "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...iso, "Content-Type": type, "Content-Length": stat.size, "Accept-Ranges": "bytes" });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const s = await serve(Number(process.env.PORT ?? 4173)); console.log("http://127.0.0.1:" + s.address().port); }

"""Live API + worker for the browser e2e (apps/web/test-harness/e2e-live.mjs).

Real API, real worker, real SQLite/ffmpeg pipeline. Only the network download is replaced: any link is "downloaded" by copying a
generated sample video; a link containing "fail" raises DOWNLOAD_FAILED, "private" mimics a private video, "long" a too-long video.
Usage: python live_server.py <workdir>   -> prints {"port": N, "srt": "<path>"} when ready.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
for sub in ("packages/core", "packages/core/tests", "apps/api"):
    sys.path.insert(0, str(ROOT / sub))
os.environ.update(LLM_PROVIDER="heuristic", ASR_PROVIDER="none")
os.environ.pop("ANTHROPIC_API_KEY", None)

import sample  # noqa: E402
import uvicorn  # noqa: E402
from app import downloader, worker  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

work = Path(sys.argv[1]); work.mkdir(parents=True, exist_ok=True)
video = work / "sample.mp4"
d = sample.total_duration()
graph = (f"color=c=0x203040:s=1280x720:r=25:d={d:.1f}[bg];color=c=white:s=140x220:r=25:d={d:.1f}[bx];"
         f"[bg][bx]overlay=x='80+900*abs(sin(t/4))':y=250,format=yuv420p[v]")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-filter_complex", graph, "-f", "lavfi", "-i", f"sine=frequency=220:sample_rate=48000:duration={d:.1f}",
                "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(video)], check=True)
srt = work / "sample.srt"; srt.write_text(sample.make_srt(), encoding="utf-8")


def fake_download(url, dest, max_minutes, max_bytes, hook=None):
    for i in range(1, 6):
        time.sleep(0.4)
        hook and hook(i / 5)
    if "fail" in url:
        raise downloader.DownloadError("DOWNLOAD_FAILED", "HTTP Error 403: Forbidden")
    if "private" in url:
        raise downloader.DownloadError("DOWNLOAD_FAILED", downloader.hint("ERROR: Private video. Sign in if you've been granted access"))
    if "long" in url:
        raise downloader.DownloadError("TOO_LONG", "too long (400 min)")
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / "import.mp4"
    shutil.copy(video, out)
    return out, "حلقة: الإنتاجية / نصائح عملية"


downloader.available = lambda: True
downloader.validate_url = lambda u, resolve=True: u if u.startswith(("http://", "https://")) and " " not in u else (_ for _ in ()).throw(downloader.DownloadError("URL_INVALID", "bad"))
downloader.download = fake_download

with socket.socket() as s:
    s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
settings = Settings(data_dir=work / "data", rate_limit_per_min=100000, cors_origins=["*"])
app = create_app(settings)
threading.Thread(target=lambda: [worker.run_one(app.state.ctx.db, settings) or time.sleep(0.3) for _ in iter(int, 1)], daemon=True).start()
server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
threading.Thread(target=server.run, daemon=True).start()
while not server.started:
    time.sleep(0.05)
print(json.dumps({"port": port, "srt": str(srt)}), flush=True)
sys.stdin.read()   # stay alive until the parent closes stdin

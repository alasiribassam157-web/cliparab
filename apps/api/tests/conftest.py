import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest
import requests
import uvicorn

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "core"))
sys.path.insert(0, str(ROOT / "packages" / "core" / "tests"))
sys.path.insert(0, str(ROOT / "apps" / "api"))
os.environ["LLM_PROVIDER"] = "heuristic"
os.environ.pop("ANTHROPIC_API_KEY", None)

import sample  # noqa: E402  (shared synthetic Arabic talk)

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app import worker  # noqa: E402


class Client:
    def __init__(self, base: str, token: str | None = None):
        self.base, self.token = base, token

    def _h(self, extra=None):
        h = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        h.update(extra or {})
        return h

    def req(self, method, path, json=None, data=None, headers=None, **kw):
        return requests.request(method, self.base + path, json=json, data=data, headers=self._h(headers), timeout=60, **kw)

    def get(self, p, **kw): return self.req("GET", p, **kw)
    def post(self, p, json=None, **kw): return self.req("POST", p, json=json, **kw)
    def patch(self, p, json=None, **kw): return self.req("PATCH", p, json=json, **kw)
    def delete(self, p, json=None, **kw): return self.req("DELETE", p, json=json, **kw)


class Server:
    def __init__(self, tmp: Path, **overrides):
        self.settings = Settings(data_dir=tmp, secret="test-secret", rate_limit_per_min=100000, **overrides)
        self.app = create_app(self.settings)
        self.db = self.app.state.ctx.db
        s = socket.socket(); s.bind(("127.0.0.1", 0)); self.port = s.getsockname()[1]; s.close()
        self.server = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        for _ in range(100):
            if self.server.started:
                break
            time.sleep(0.05)
        self.base = f"http://127.0.0.1:{self.port}"

    def stop(self):
        self.server.should_exit = True
        self.thread.join(timeout=5)

    def client(self, token=None) -> Client:
        return Client(self.base, token)

    def signup(self, email="a@example.com", password="correct-horse-1", name="أحمد") -> Client:
        r = requests.post(self.base + "/v1/auth/register", json={"email": email, "password": password, "name": name}, timeout=30)
        assert r.status_code == 201, r.text
        return Client(self.base, r.json()["token"])

    def drain(self):
        while worker.run_one(self.db, self.settings):
            pass


@pytest.fixture
def server(tmp_path):
    s = Server(tmp_path / "data")
    yield s
    s.stop()


@pytest.fixture(scope="session")
def video_bytes(tmp_path_factory) -> bytes:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg missing")
    d = sample.total_duration()
    out = tmp_path_factory.mktemp("m") / "talk.mp4"
    graph = (f"color=c=0x203040:s=1280x720:r=25:d={d:.1f}[bg];color=c=white:s=140x220:r=25:d={d:.1f}[bx];"
             f"[bg][bx]overlay=x='80+900*abs(sin(t/4))':y=250,format=yuv420p[v]")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-filter_complex", graph, "-f", "lavfi", "-i",
                    f"sine=frequency=220:sample_rate=48000:duration={d:.1f}", "-map", "[v]", "-map", "0:a", "-c:v", "libx264",
                    "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(out)], check=True)
    return out.read_bytes()


@pytest.fixture(scope="session")
def srt_text() -> str:
    return sample.make_srt()


def make_project(c: Client, video_bytes: bytes, srt_text: str | None, name="حلقة تجريبية") -> str:
    pid = c.post("/v1/projects", {"name": name}).json()["id"]
    r = c.req("POST", f"/v1/projects/{pid}/source?filename=talk.mp4", data=video_bytes)
    assert r.status_code == 201, r.text
    if srt_text:
        r = c.req("PUT", f"/v1/projects/{pid}/subtitles", data=srt_text.encode("utf-8"))
        assert r.status_code == 200, r.text
    return pid

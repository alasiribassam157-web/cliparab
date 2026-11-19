import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import sample  # noqa: E402

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture(scope="session")
def srt_path(tmp_path_factory) -> Path:
    p = tmp_path_factory.mktemp("data") / "talk.srt"
    p.write_text(sample.make_srt(), encoding="utf-8")
    return p


@pytest.fixture(scope="session")
def video_path(tmp_path_factory) -> Path:
    """16:9 test clip: a white box oscillating left-right (x = 80 + 900|sin(t/4)|) + a tone, as long as the sample talk."""
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    d = sample.total_duration()
    out = tmp_path_factory.mktemp("media") / "talk.mp4"
    graph = (f"color=c=0x203040:s=1280x720:r=25:d={d:.1f}[bg];color=c=white:s=140x220:r=25:d={d:.1f}[bx];"
             f"[bg][bx]overlay=x='80+900*abs(sin(t/4))':y=250,format=yuv420p[v]")
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-filter_complex", graph,
        "-f", "lavfi", "-i", f"sine=frequency=220:sample_rate=48000:duration={d:.1f}",
        "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(out)],
        check=True)
    return out

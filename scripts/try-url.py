#!/usr/bin/env python3
"""Check that a real link can be imported on THIS machine (same code path as the worker), without starting the API.

    python scripts/try-url.py "https://www.youtube.com/watch?v=..."        # from the repo root

Prints the title, size, duration and resolution, or the exact reason it failed (bot check, missing Deno, private video...).
"""
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps" / "api"), str(ROOT / "packages" / "core")]
from app import downloader  # noqa: E402
from cliparab_core import media  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    print("yt-dlp available:", downloader.available(), "| deno:", shutil.which("deno") or "NOT FOUND (needed for YouTube)",
          "| ffmpeg:", shutil.which("ffmpeg") or "NOT FOUND")
    tmp = Path(tempfile.mkdtemp(prefix="cliparab-try-"))
    try:
        path, title = downloader.download(sys.argv[1], tmp, max_minutes=180, max_bytes=2 * 1024**3,
                                          hook=lambda f: print(f"\r  downloading {f:5.0%}", end="", flush=True))
        info = media.probe(str(path))
        print(f"\nOK  title={title!r}  size={path.stat().st_size / 1e6:.1f} MB  duration={info['duration'] / 60:.1f} min  {info['width']}x{info['height']}")
        return 0
    except downloader.DownloadError as e:
        print(f"\nFAILED [{e.code}] {e.detail}")
        return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())

"""Import a source video from a public link (YouTube and any site yt-dlp supports, or a direct media URL).

Safety: only http(s) links to public hosts are accepted (no loopback/private/link-local targets, no credentials in the URL),
playlists are refused, and size and duration are capped. Needs the optional ``yt-dlp`` package (``pip install yt-dlp``).
"""

from __future__ import annotations

import ipaddress
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

MEDIA_SUFFIXES = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".mp3", ".wav", ".m4a"}


def hint(msg: str) -> str:
    """Short operator hint for the failures people actually hit; the raw yt-dlp text is kept after it."""
    low = msg.lower()
    if "confirm you" in low and "bot" in low or "sign in" in low:
        return "site asked for sign-in / bot check: set YTDLP_COOKIES_FILE. " + msg[:240]
    if "javascript runtime" in low or "n challenge" in low or "ejs" in low:
        return "YouTube needs a JS runtime (Deno) + yt-dlp[default]. " + msg[:240]
    if "private video" in low or "members-only" in low or "drm" in low:
        return "private or protected video. " + msg[:240]
    return msg[:300]


class DownloadError(Exception):
    """``code`` is an ApiError code: URL_INVALID, DOWNLOAD_UNAVAILABLE, DOWNLOAD_FAILED or TOO_LONG."""

    def __init__(self, code: str, detail: str = ""):
        self.code, self.detail = code, detail
        super().__init__(f"{code}: {detail}")


def _is_public(ip: str) -> bool:
    a = ipaddress.ip_address(ip.split("%")[0])
    return not (a.is_private or a.is_loopback or a.is_link_local or a.is_multicast or a.is_reserved or a.is_unspecified)


def validate_url(url: str, resolve: bool = True) -> str:
    """Return the cleaned URL or raise DownloadError('URL_INVALID')."""
    url = (url or "").strip()
    if not url or any(ch.isspace() or ord(ch) < 32 for ch in url):
        raise DownloadError("URL_INVALID", "whitespace or control characters")
    try:
        u = urlsplit(url)
        host = u.hostname or ""
        port = u.port
    except ValueError:
        raise DownloadError("URL_INVALID", "unparsable") from None
    if u.scheme not in ("http", "https") or not host or u.username or u.password:
        raise DownloadError("URL_INVALID", "scheme or credentials")
    if port not in (None, 80, 443):
        raise DownloadError("URL_INVALID", "port")
    if host.lower() in ("localhost",) or host.lower().endswith((".local", ".internal", ".localhost")):
        raise DownloadError("URL_INVALID", "private host")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public(str(literal)):
            raise DownloadError("URL_INVALID", "private address")
    elif resolve:
        try:
            infos = socket.getaddrinfo(host, port or 443, proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            raise DownloadError("URL_INVALID", "unresolvable host") from None
        if not infos or not all(_is_public(i[4][0]) for i in infos):
            raise DownloadError("URL_INVALID", "private address")
    return url


def available() -> bool:
    try:
        import yt_dlp  # noqa: F401
        return True
    except ImportError:
        return shutil.which("yt-dlp") is not None


def format_for(max_bytes: int) -> str:
    """Best quality up to 1080p that still fits ``max_bytes``; long videos step down to 720p/480p instead of failing.

    ``filesize_approx<=?`` keeps streams whose size is unknown, so short or size-less sources still get 1080p.
    """
    v = int(max_bytes * 0.9)
    return (f"bv*[height<=1080][filesize_approx<=?{v}]+ba/bv*[height<=720][filesize_approx<=?{v}]+ba/"
            f"bv*[height<=480][filesize_approx<=?{v}]+ba/b[height<=720][filesize_approx<=?{v}]/b[height<=480]/b")


def _opts(dest: Path, max_minutes: int, max_bytes: int, hook: Callable[[float], None] | None) -> dict:
    def too_long(info, *, incomplete=False):
        d = info.get("duration")
        if d and d > max_minutes * 60:
            return f"too long ({int(d // 60)} min)"
        return None

    def progress(d: dict) -> None:
        if hook and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                hook(min(d.get("downloaded_bytes", 0) / total, 1.0))

    o: dict = {
        "outtmpl": str(dest / "import.%(ext)s"), "noplaylist": True, "quiet": True, "no_warnings": True, "restrictfilenames": True,
        "format": format_for(max_bytes), "merge_output_format": "mp4", "max_filesize": max_bytes,
        "match_filter": too_long, "socket_timeout": 30, "retries": 3, "progress_hooks": [progress], "nocheckcertificate": False,
    }
    cookies = os.getenv("YTDLP_COOKIES_FILE")
    if cookies and Path(cookies).is_file():
        o["cookiefile"] = cookies
    return o


def download(url: str, dest: Path, max_minutes: int, max_bytes: int, hook: Callable[[float], None] | None = None) -> tuple[Path, str]:
    """Download ``url`` into ``dest`` and return (file path, title). Raises DownloadError."""
    url = validate_url(url)
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("import.*"):
        old.unlink(missing_ok=True)
    try:
        import yt_dlp
    except ImportError:
        yt_dlp = None
    title = ""
    if yt_dlp is not None:
        try:
            with yt_dlp.YoutubeDL(_opts(dest, max_minutes, max_bytes, hook)) as ydl:
                info = ydl.extract_info(url, download=True)
        except yt_dlp.utils.DownloadError as e:
            msg = str(e)
            if "too long" in msg:
                raise DownloadError("TOO_LONG", msg[:200]) from None
            raise DownloadError("DOWNLOAD_FAILED", hint(msg)) from None
        if not info or info.get("_type") == "playlist" and not info.get("entries"):
            raise DownloadError("DOWNLOAD_FAILED", "nothing downloaded")
        if info.get("_type") == "playlist":
            info = (info.get("entries") or [{}])[0]
        title = (info.get("title") or "")[:160]
    elif shutil.which("yt-dlp"):
        cmd = ["yt-dlp", "--no-playlist", "--quiet", "--no-warnings", "--restrict-filenames", "-f", format_for(max_bytes),
               "--merge-output-format", "mp4", "--max-filesize", str(max_bytes), "--match-filter", f"duration<={max_minutes * 60}",
               "-o", str(dest / "import.%(ext)s"), "--print", "title", "--no-simulate", url]
        cookies = os.getenv("YTDLP_COOKIES_FILE")
        if cookies and Path(cookies).is_file():
            cmd[1:1] = ["--cookies", cookies]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, check=False)
        except subprocess.TimeoutExpired:
            raise DownloadError("DOWNLOAD_FAILED", "timeout") from None
        if r.returncode != 0:
            raise DownloadError("DOWNLOAD_FAILED", hint((r.stderr or "")[-400:]))
        title = (r.stdout.strip().splitlines() or [""])[0][:160]
    else:
        raise DownloadError("DOWNLOAD_UNAVAILABLE", "yt-dlp is not installed")
    files = sorted((f for f in dest.glob("import.*") if f.suffix.lower() in MEDIA_SUFFIXES and f.is_file()), key=lambda f: f.stat().st_size, reverse=True)
    if not files:
        raise DownloadError("DOWNLOAD_FAILED", "no media file produced (too large, too long, or unsupported)")
    return files[0], title

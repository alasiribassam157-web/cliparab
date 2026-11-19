"""Unit tests for app.downloader with a stand-in ``yt_dlp`` module and a stand-in ``yt-dlp`` executable (no network)."""
import os
import stat
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import downloader as dl  # noqa: E402


class FakeDownloadError(Exception):
    pass


def install_fake_ytdlp(monkeypatch, behaviour):
    """behaviour(opts, url) -> info dict (and may write files / raise FakeDownloadError)."""
    seen = {}
    mod = types.ModuleType("yt_dlp")
    mod.utils = types.SimpleNamespace(DownloadError=FakeDownloadError)

    class YoutubeDL:
        def __init__(self, opts):
            seen["opts"] = opts
            self.opts = opts

        def __enter__(self): return self
        def __exit__(self, *a): return False

        def extract_info(self, url, download=True):
            seen["url"] = url
            return behaviour(self.opts, url)

    mod.YoutubeDL = YoutubeDL
    monkeypatch.setitem(sys.modules, "yt_dlp", mod)
    return seen


def writes(name, data=b"x" * 100):
    def b(opts, url):
        out = Path(opts["outtmpl"]).parent / name
        out.write_bytes(data)
        opts["progress_hooks"][0]({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100})
        return {"title": "عنوان الفيديو", "duration": 600}
    return b


def public(monkeypatch):
    monkeypatch.setattr(dl, "validate_url", lambda u, resolve=True: u)


def test_success_sets_safe_options_and_reports_progress(tmp_path, monkeypatch):
    public(monkeypatch)
    seen = install_fake_ytdlp(monkeypatch, writes("import.mp4"))
    ticks = []
    path, title = dl.download("https://www.youtube.com/watch?v=abc", tmp_path / "d", 180, 2 * 1024**3, ticks.append)
    assert path.name == "import.mp4" and title == "عنوان الفيديو" and ticks == [0.5]
    o = seen["opts"]
    assert o["noplaylist"] is True and o["max_filesize"] == 2 * 1024**3 and o["merge_output_format"] == "mp4"
    assert o["restrictfilenames"] is True and o["format"].startswith("bv*[height<=1080]")

    assert o["match_filter"]({"duration": 179 * 60}) is None and "too long" in o["match_filter"]({"duration": 181 * 60})
    assert o["match_filter"]({}) is None                                           # unknown duration is allowed; probe re-checks it
    assert "cookiefile" not in o


def test_long_videos_step_down_quality_instead_of_exceeding_the_size_cap():
    f = dl.format_for(2 * 1024**3)
    alts = f.split("/")
    assert alts[0].startswith("bv*[height<=1080]") and any("height<=720" in a for a in alts) and alts[-1] == "b"
    assert all("filesize_approx<=?" in a for a in alts[:4])           # each preferred option must fit the cap
    assert str(int(2 * 1024**3 * 0.9)) in alts[0]


def test_cookies_file_is_used_when_configured(tmp_path, monkeypatch):
    public(monkeypatch)
    ck = tmp_path / "cookies.txt"; ck.write_text("# Netscape HTTP Cookie File\n")
    monkeypatch.setenv("YTDLP_COOKIES_FILE", str(ck))
    seen = install_fake_ytdlp(monkeypatch, writes("import.mp4"))
    dl.download("https://example.com/v", tmp_path / "d", 180, 10**9)
    assert seen["opts"]["cookiefile"] == str(ck)


def test_playlist_result_takes_first_entry_title(tmp_path, monkeypatch):
    public(monkeypatch)

    def b(opts, url):
        (Path(opts["outtmpl"]).parent / "import.webm").write_bytes(b"y" * 10)
        return {"_type": "playlist", "entries": [{"title": "الأولى"}]}
    install_fake_ytdlp(monkeypatch, b)
    path, title = dl.download("https://example.com/p", tmp_path / "d", 180, 10**9)
    assert path.suffix == ".webm" and title == "الأولى"


@pytest.mark.parametrize("msg,code,needle", [
    ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "DOWNLOAD_FAILED", "YTDLP_COOKIES_FILE"),
    ("ERROR: Signature solving failed: no JavaScript runtime found", "DOWNLOAD_FAILED", "Deno"),
    ("ERROR: Private video. Sign in if you've been granted access", "DOWNLOAD_FAILED", "YTDLP_COOKIES_FILE"),
    ("ERROR: Video unavailable", "DOWNLOAD_FAILED", "unavailable"),
    ("ERROR: Video rejected by match filter: too long (400 min)", "TOO_LONG", "too long"),
])
def test_errors_map_to_codes_and_hints(tmp_path, monkeypatch, msg, code, needle):
    public(monkeypatch)

    def b(opts, url):
        raise FakeDownloadError(msg)
    install_fake_ytdlp(monkeypatch, b)
    with pytest.raises(dl.DownloadError) as e:
        dl.download("https://example.com/v", tmp_path / "d", 180, 10**9)
    assert e.value.code == code and needle.lower() in e.value.detail.lower()


def test_no_media_file_is_a_failure(tmp_path, monkeypatch):
    public(monkeypatch)
    install_fake_ytdlp(monkeypatch, lambda o, u: {"title": "x"})     # e.g. skipped by max_filesize
    with pytest.raises(dl.DownloadError) as e:
        dl.download("https://example.com/v", tmp_path / "d", 180, 10**9)
    assert e.value.code == "DOWNLOAD_FAILED"


def test_stale_partial_files_are_cleared_and_largest_media_wins(tmp_path, monkeypatch):
    public(monkeypatch)
    d = tmp_path / "d"; d.mkdir()
    (d / "import.mp4").write_bytes(b"old-leftover")

    def b(opts, url):
        assert not (d / "import.mp4").exists()
        (d / "import.m4a").write_bytes(b"a" * 5)
        (d / "import.mp4").write_bytes(b"v" * 50)
        (d / "import.mp4.part").write_bytes(b"z" * 999)
        return {"title": "t"}
    install_fake_ytdlp(monkeypatch, b)
    path, _ = dl.download("https://example.com/v", d, 180, 10**9)
    assert path.name == "import.mp4"


def test_cli_fallback_when_module_missing(tmp_path, monkeypatch):
    public(monkeypatch)
    monkeypatch.setitem(sys.modules, "yt_dlp", None)               # makes `import yt_dlp` raise ImportError
    bindir = tmp_path / "bin"; bindir.mkdir()
    exe = bindir / "yt-dlp"
    exe.write_text("#!/bin/sh\nfor a in \"$@\"; do case \"$prev\" in -o) out=\"$a\";; esac; prev=\"$a\"; done\n"
                   "printf 'video' > \"$(dirname \"$out\")/import.mp4\"\necho 'عنوان من CLI'\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", str(bindir) + os.pathsep + os.environ["PATH"])
    assert dl.available()
    path, title = dl.download("https://example.com/v", tmp_path / "d", 180, 10**9)
    assert path.name == "import.mp4" and title == "عنوان من CLI"


def test_cli_failure_and_missing_everything(tmp_path, monkeypatch):
    public(monkeypatch)
    monkeypatch.setitem(sys.modules, "yt_dlp", None)
    monkeypatch.setenv("PATH", "/nonexistent")
    assert not dl.available()
    with pytest.raises(dl.DownloadError) as e:
        dl.download("https://example.com/v", tmp_path / "d", 180, 10**9)
    assert e.value.code == "DOWNLOAD_UNAVAILABLE"
    bindir = tmp_path / "bin"; bindir.mkdir()
    exe = bindir / "yt-dlp"
    exe.write_text("#!/bin/sh\necho \"ERROR: Sign in to confirm you're not a bot\" >&2\nexit 1\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", str(bindir))
    with pytest.raises(dl.DownloadError) as e:
        dl.download("https://example.com/v", tmp_path / "d", 180, 10**9)
    assert e.value.code == "DOWNLOAD_FAILED" and "YTDLP_COOKIES_FILE" in e.value.detail


def test_validate_url_edge_cases():
    for bad in ["https://exa mple.com", "https://", "javascript:alert(1)", "http://0.0.0.0/a", "http://10.0.0.1/a", "http://[fe80::1]/a",
                "http://metadata.google.internal/a", "http://printer.local/a", "https://example.com:22/a", ""]:
        with pytest.raises(dl.DownloadError) as e:
            dl.validate_url(bad, resolve=False)
        assert e.value.code == "URL_INVALID", bad
    assert dl.validate_url("  https://youtu.be/abc?t=5  ", resolve=False) == "https://youtu.be/abc?t=5"

"""FFmpeg rendering of a clip from an ``EditState``."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

from . import media, reframe
from .captions import CaptionStyle, build_ass
from .models import Word

RESOLUTIONS = {"720p": (720, 1280), "1080p": (1080, 1920)}
SAFE_FONTS = ("Tajawal", "Almarai", "Noto Kufi Arabic", "Noto Sans Arabic", "Noto Naskh Arabic", "DejaVu Sans")


@dataclass
class EditState:
    """Everything needed to re-render a clip. Stored as JSONB (``clips.edit_state``)."""

    start: float
    end: float
    layout: str = "fill"                 # fill | fit | split
    reframe_mode: str = "auto"           # auto | center | manual
    manual_center: float = 0.5
    split_centers: tuple[float, float] | None = None
    captions: bool = True
    caption: dict = field(default_factory=dict)
    words: list[dict] | None = None      # user-edited transcript words (override)
    resolution: str = "1080p"
    fps: int = 30
    crf: int = 20
    preset: str = "veryfast"
    loudnorm: bool = True
    denoise: bool = False

    @classmethod
    def from_dict(cls, d: dict) -> "EditState":
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        if known.get("split_centers"):
            known["split_centers"] = tuple(known["split_centers"])
        return cls(**known)

    def to_dict(self) -> dict:
        return asdict(self)

    def validate(self, duration: float | None = None) -> None:
        if self.end - self.start < 1.0:
            raise ValueError("clip shorter than 1 second")
        if self.end - self.start > 180:
            raise ValueError("clip longer than 180 seconds")
        if duration is not None and self.start > duration:
            raise ValueError("clip starts after the end of the source")
        if self.layout not in ("fill", "fit", "split"):
            raise ValueError(f"unknown layout {self.layout}")
        if self.resolution not in RESOLUTIONS:
            raise ValueError(f"unknown resolution {self.resolution}")


def find_fonts_dir(explicit: str | None = None) -> str | None:
    for c in (explicit, os.getenv("CLIPARAB_FONTS_DIR"), "assets/fonts", "/usr/share/fonts/truetype/cliparab"):
        if c and Path(c).is_dir():
            return c
    return None


def pick_font(preferred: str) -> str:
    """Return ``preferred`` if fontconfig knows it, else the first available Arabic-capable fallback."""
    try:
        listing = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True).stdout
    except FileNotFoundError:
        return preferred
    for name in (preferred, *SAFE_FONTS):
        if re.search(rf"(^|[,\n]){re.escape(name)}($|[,\n])", listing):
            return name
    return preferred


def build_command(source: str, es: EditState, probe: dict, graph_script: str, out_path: str, has_audio: bool) -> list[str]:
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{es.start:.3f}", "-t", f"{es.end - es.start:.3f}", "-i", source,
           "-filter_complex_script", graph_script, "-map", "[v]"]
    if has_audio:
        af = []
        if es.denoise:
            af.append("highpass=f=80,afftdn=nf=-25")
        if es.loudnorm:
            af.append("loudnorm=I=-14:LRA=11:TP=-1.5")
        cmd += ["-map", "0:a:0"] + (["-af", ",".join(af)] if af else []) + ["-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    cmd += ["-c:v", "libx264", "-preset", es.preset, "-crf", str(es.crf), "-pix_fmt", "yuv420p", "-r", str(es.fps),
            "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", out_path]
    return cmd


def render_clip(source: str, es: EditState, words: list[Word], out_path: str, workdir: str,
                track: list[tuple[float, float]] | None = None, fonts_dir: str | None = None,
                on_progress: Callable[[float], None] | None = None, probe: dict | None = None) -> dict:
    """Render ``es`` from ``source`` into ``out_path`` (MP4, H.264/AAC). Returns render metadata."""
    probe = probe or media.probe(source)
    es.validate(probe["duration"])
    out_w, out_h = RESOLUTIONS[es.resolution]
    work = Path(workdir)
    work.mkdir(parents=True, exist_ok=True)
    geo = reframe.crop_geometry(probe["width"], probe["height"])

    if es.reframe_mode == "manual":
        track = [(0.0, es.manual_center), (es.end - es.start, es.manual_center)]
    elif es.reframe_mode == "center" or track is None:
        track = [(0.0, 0.5), (es.end - es.start, 0.5)] if es.reframe_mode == "center" else \
            media.track_subject(source, es.start, es.end)
    keys = reframe.smooth_path(track, geo)

    ass_name = None
    if es.captions:
        cap = CaptionStyle.from_dict(es.caption)
        cap.font = pick_font(cap.font)
        if es.words is not None:
            use_words = [Word.from_dict(w) for w in es.words]
        else:
            use_words = words
        ass_text = build_ass(use_words, es.start, es.end, cap, out_w, out_h)
        ass_name = "captions.ass"
        (work / ass_name).write_text(ass_text, encoding="utf-8")

    fdir = find_fonts_dir(fonts_dir)
    fonts_rel = None
    if fdir:
        dst = work / "fonts"
        if not dst.exists():
            shutil.copytree(fdir, dst)
        fonts_rel = "fonts"
    graph = reframe.build_video_graph(es.layout, geo, keys, ass_name, fonts_rel, es.split_centers, out_w, out_h)
    (work / "graph.txt").write_text(graph, encoding="utf-8")

    out_abs = str(Path(out_path).resolve())
    Path(out_abs).parent.mkdir(parents=True, exist_ok=True)
    cmd = build_command(str(Path(source).resolve()), es, probe, "graph.txt", out_abs, probe["has_audio"])
    total = es.end - es.start
    proc = subprocess.Popen(cmd, cwd=str(work), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout is not None
    for line in proc.stdout:
        if line.startswith("out_time_ms=") and on_progress:
            try:
                on_progress(min(1.0, int(line.split("=")[1]) / 1_000_000 / total))
            except ValueError:
                pass
    err = proc.stderr.read() if proc.stderr else ""
    if proc.wait() != 0:
        raise media.MediaError(f"ffmpeg render failed: {err[-1000:]}")
    if on_progress:
        on_progress(1.0)
    info = media.probe(out_abs)
    (work / "render.json").write_text(json.dumps({"edit_state": es.to_dict(), "output": info}, ensure_ascii=False, indent=2))
    return {"path": out_abs, **info}

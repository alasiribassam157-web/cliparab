"""SRT / WebVTT import and export.

Imported subtitles have segment-level timing only, so word times are interpolated
proportionally to word length and flagged ``approx=True``.
"""

from __future__ import annotations

import re

from .models import Segment, Transcript, Word

_TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})")


def _parse_ts(s: str) -> float:
    m = _TS.search(s)
    if not m:
        raise ValueError(f"bad timestamp: {s!r}")
    h, mi, se, ms = m.groups()
    return int(h or 0) * 3600 + int(mi) * 60 + int(se) + int(ms.ljust(3, "0")) / 1000


def fmt_srt_ts(t: float) -> str:
    t = max(0.0, t)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def interpolate_words(text: str, start: float, end: float, speaker: str | None = None) -> list[Word]:
    tokens = text.split()
    if not tokens:
        return []
    weights = [max(len(t), 1) for t in tokens]
    total = sum(weights)
    dur = max(end - start, 0.001)
    out: list[Word] = []
    cur = start
    for tok, w in zip(tokens, weights):
        nxt = cur + dur * w / total
        out.append(Word(text=tok, start=round(cur, 3), end=round(nxt, 3), conf=0.9, speaker=speaker, approx=True))
        cur = nxt
    return out


def parse_subtitles(raw: str, language: str = "ar") -> Transcript:
    """Parse SRT or VTT text into a :class:`Transcript`."""
    raw = raw.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    blocks = re.split(r"\n\s*\n", raw.strip())
    segments: list[Segment] = []
    for block in blocks:
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if not lines or lines[0].upper().startswith("WEBVTT"):
            continue
        ts_idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if ts_idx is None:
            continue
        left, right = lines[ts_idx].split("-->", 1)
        start, end = _parse_ts(left), _parse_ts(right)
        text = " ".join(re.sub(r"<[^>]+>", "", ln).strip() for ln in lines[ts_idx + 1:]).strip()
        if not text:
            continue
        seg = Segment(id=len(segments), start=start, end=end, text=text,
                      words=interpolate_words(text, start, end))
        segments.append(seg)
    duration = segments[-1].end if segments else 0.0
    return Transcript(language=language, segments=segments, engine="subtitle-import", duration=duration)


def to_srt(segments: list[tuple[float, float, str]]) -> str:
    out = []
    for i, (a, b, t) in enumerate(segments, 1):
        out.append(f"{i}\n{fmt_srt_ts(a)} --> {fmt_srt_ts(b)}\n{t}\n")
    return "\n".join(out)

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

from cliparab_core import media
from cliparab_core.pipeline import AnalyzeOptions, Project, analyze, render
from cliparab_core.providers import HeuristicLLM
from cliparab_core.render import EditState, render_clip
from cliparab_core.subtitles import parse_subtitles

import sample
from conftest import needs_ffmpeg

pytestmark = needs_ffmpeg


def _frame(path: Path, t: float, out: Path) -> np.ndarray:
    import cv2
    media.extract_frame(str(path), t, str(out), width=540)
    return cv2.imread(str(out))


def test_probe_and_audio_and_proxy(video_path, tmp_path):
    info = media.probe(str(video_path))
    assert (info["width"], info["height"]) == (1280, 720) and info["has_audio"] and info["fps"] == 25
    wav = media.extract_audio(str(video_path), str(tmp_path / "a.wav"))
    db = media.rms_db_per_window(wav)
    assert len(db) > 100 and all(-60 < v < 0 for v in db[:10])
    proxy = media.make_proxy(str(video_path), str(tmp_path / "p.mp4"))
    assert media.probe(proxy)["height"] == 360


def test_motion_tracking_follows_the_moving_subject(video_path):
    import math
    track = media.track_subject(str(video_path), 5, 45, step=1.0, mode="motion")
    assert all(0 <= x <= 1 for _, x in track)
    expected = [(80 + 900 * abs(math.sin((5 + t) / 4)) + 70) / 1280 for t, _ in track]
    err = [abs(x - e) for (_, x), e in zip(track, expected)]
    assert sum(err) / len(err) < 0.12, (track, expected)
    assert max(x for _, x in track) - min(x for _, x in track) > 0.3     # actually moved


def test_analyze_is_idempotent_and_saves_artifacts(video_path, srt_path, tmp_path):
    p = Project(tmp_path / "proj")
    first = analyze(str(video_path), p, subtitles=str(srt_path), llm=HeuristicLLM(), opts=AnalyzeOptions(max_clips=6))
    assert len(first) >= 3
    for name in ("probe.json", "transcript.json", "suggestions.json"):
        assert p.has(name)
    mtime = p.path("suggestions.json").stat().st_mtime_ns
    again = analyze(str(video_path), p, subtitles=str(srt_path), llm=HeuristicLLM(), opts=AnalyzeOptions(max_clips=6))
    assert p.path("suggestions.json").stat().st_mtime_ns == mtime           # stage skipped, not recomputed
    assert [c.start for c in again] == [c.start for c in first]
    sug = p.load("suggestions.json")
    assert sug[0]["id"] == "c01" and sug[0]["rank"] == 1 and sug[0]["engine"] == "heuristic"
    assert sug[0]["total"] >= sug[-1]["total"]


def test_analyze_needs_a_transcript_source(video_path, tmp_path):
    with pytest.raises(ValueError):
        analyze(str(video_path), Project(tmp_path / "x"), llm=HeuristicLLM())


def test_render_vertical_with_burned_arabic_captions(video_path, srt_path, tmp_path):
    p = Project(tmp_path / "proj")
    clips = analyze(str(video_path), p, subtitles=str(srt_path), llm=HeuristicLLM())
    progress: list[float] = []
    res = render(str(video_path), p, "c01", {"resolution": "720p"}, on_progress=progress.append)
    assert (res["width"], res["height"]) == (720, 1280)
    assert abs(res["duration"] - clips[0].duration) < 0.6
    assert res["has_audio"] and res["video_codec"] == "h264" and res["audio_codec"] == "aac"
    assert progress and progress[-1] == 1.0 and progress == sorted(progress)
    ass = (p.path("render_c01") / "captions.ass").read_text(encoding="utf-8")
    assert "Dialogue:" in ass
    # captions really are burned in: the bottom safe zone has bright text pixels, the same frame without captions doesn't
    out = Path(res["path"])
    with_caps = _frame(out, 3.0, tmp_path / "a.jpg")
    res2 = render(str(video_path), p, "c01", {"resolution": "720p", "captions": False}, out_name="nocap.mp4")
    no_caps = _frame(Path(res2["path"]), 3.0, tmp_path / "b.jpg")
    h = with_caps.shape[0]
    band = slice(int(h * 0.62), int(h * 0.80))
    changed = (np.abs(with_caps[band].astype(int) - no_caps[band].astype(int)).sum(axis=2) > 90).sum()
    assert changed > 1500, changed                         # text pixels exist only in the captioned render
    assert (np.abs(with_caps[: int(h * 0.5)].astype(int) - no_caps[: int(h * 0.5)].astype(int)).sum(axis=2) > 90).sum() < 200


def test_fit_and_split_layouts_render(video_path, srt_path, tmp_path):
    p = Project(tmp_path / "proj")
    analyze(str(video_path), p, subtitles=str(srt_path), llm=HeuristicLLM())
    for layout, extra in (("fit", {}), ("split", {"split_centers": [0.25, 0.75]})):
        res = render(str(video_path), p, "c02", {"layout": layout, "resolution": "720p", "captions": False, **extra},
                     out_name=f"{layout}.mp4")
        assert (res["width"], res["height"]) == (720, 1280)


def test_edit_state_validation_and_word_override(video_path, srt_path, tmp_path):
    with pytest.raises(ValueError):
        EditState(start=5, end=5.5).validate()
    with pytest.raises(ValueError):
        EditState(start=0, end=10, layout="weird").validate()
    tr = parse_subtitles(srt_path.read_text(encoding="utf-8"))
    custom = [{"text": "كلمة", "start": 1.0, "end": 2.0}, {"text": "معدلة", "start": 2.0, "end": 3.0}]
    es = EditState(start=0.8, end=12.0, resolution="720p", reframe_mode="center", words=custom, loudnorm=False)
    render_clip(str(video_path), es, tr.words(), str(tmp_path / "o.mp4"), str(tmp_path / "w"))
    assert "معدلة" in (tmp_path / "w" / "captions.ass").read_text(encoding="utf-8")

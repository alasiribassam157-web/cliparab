import re

import sample
from cliparab_core.captions import CaptionStyle, build_ass
from cliparab_core.reframe import build_video_graph, crop_geometry, lerp_expr, smooth_path
from cliparab_core.subtitles import parse_subtitles


def test_crop_geometry_landscape_and_portrait():
    g = crop_geometry(1920, 1080)
    assert g.horizontal and g.crop_h == 1080 and g.crop_w == 606
    p = crop_geometry(720, 1280)
    assert not p.horizontal and p.crop_w == 720 and p.crop_h == 1280
    sq = crop_geometry(1080, 1080)
    assert sq.horizontal and sq.crop_w == 606


def test_smooth_path_ignores_jitter_limits_speed_and_clamps():
    g = crop_geometry(1920, 1080)
    jitter = [(i * 0.5, 0.5 + (0.005 if i % 2 else -0.005)) for i in range(20)]
    keys = smooth_path(jitter, g)
    assert max(v for _, v in keys) - min(v for _, v in keys) < 1.0          # dead-zone: no wobble
    jump = [(0.0, 0.1), (0.5, 0.1), (1.0, 0.9), (1.5, 0.9), (2.0, 0.9)]
    keys = smooth_path(jump, g)
    steps = [abs(b[1] - a[1]) for a, b in zip(keys, keys[1:])]
    assert max(steps) <= 0.5 * g.crop_w * 0.5 + 1e-6                          # speed limit
    assert all(0 <= v <= g.src_w - g.crop_w for _, v in keys)                  # stays inside the frame


def test_lerp_expr_is_piecewise_linear_and_escaped():
    e = lerp_expr([(0, 0), (1, 100), (2, 100)])
    assert e.count("if(") == 2 and "\\," in e and "," not in e.replace("\\,", "")
    assert lerp_expr([(0, 42)]) == "42.0"


def test_graphs_for_each_layout():
    g = crop_geometry(1280, 720)
    keys = [(0, 0), (5, 300)]
    fill = build_video_graph("fill", g, keys, "captions.ass", "fonts")
    assert fill.startswith("[0:v]crop=404:720:x='") and "scale=1080:1920" in fill and fill.endswith("[v]")
    assert "ass=captions.ass:fontsdir=fonts" in fill
    assert "overlay" in build_video_graph("fit", g, keys, None)
    split = build_video_graph("split", g, keys, None, split_centers=(0.25, 0.75))
    assert "vstack" in split and split.count("crop=") == 2
    port = build_video_graph("fill", crop_geometry(720, 1280), [(0, 0)], None)
    assert "y='0.0'" in port or "y=0" in port


def test_ass_structure_rtl_and_timing():
    tr = parse_subtitles(sample.make_srt())
    seg = tr.segments[3]
    ass = build_ass(seg.words, seg.start - 0.2, seg.end + 0.2, CaptionStyle(emphasis=[seg.words[-1].text]))
    assert "PlayResX: 1080" in ass and "PlayResY: 1920" in ass and "Style: Cap,Tajawal" in ass
    events = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert events
    assert "\\k" in events[0]
    assert "\\fscx112" in ass                                            # emphasis word
    first = re.match(r"Dialogue: 0,(\d+):(\d\d):(\d\d)\.(\d\d),", events[0])
    assert first and int(first.group(2)) == 0
    assert any("مثلا" in e or "كتابا" in e for e in events)
    # margins: bottom safe zone is 22% of 1920
    assert ",2,90,90,422,1" in ass


def test_ass_modes_and_escaping():
    from cliparab_core.models import Word
    words = [Word("{hack}", 0, 0.5), Word("اختبار", 0.5, 1.0)]
    plain = build_ass(words, 0, 1, CaptionStyle(mode="plain", position="top", box=True))
    assert "{hack}" not in plain and "(hack)" in plain and ",8,90,90,230,1" in plain and "\\k" not in plain
    pop = build_ass(words, 0, 1, CaptionStyle(mode="pop"))
    assert len([l for l in pop.splitlines() if l.startswith("Dialogue:")]) == 2

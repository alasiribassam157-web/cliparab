"""Arabic RTL captions as ASS (libass + HarfBuzz shaping, so letters join correctly).

Styles
------
``karaoke``  words highlight as they are spoken (``\\k`` timing)
``plain``    whole event appears at once
``pop``      one word at a time, large

Safe zones keep text clear of TikTok/Reels/Shorts UI (bottom ~22%, right edge).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import text_ar as ar
from .models import Word

POSITIONS = {"bottom": (2, 0.22), "middle": (5, 0.0), "top": (8, 0.12)}  # (ASS alignment, margin fraction)


@dataclass
class CaptionStyle:
    mode: str = "karaoke"
    font: str = "Tajawal"
    font_size: int = 74
    color: str = "#FFFFFF"
    highlight: str = "#FFD21F"
    outline_color: str = "#000000"
    outline: float = 5.0
    shadow: float = 0.0
    bold: bool = True
    position: str = "bottom"
    max_chars_per_line: int = 22
    box: bool = False
    emphasis: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict | None) -> "CaptionStyle":
        d = d or {}
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


def _ass_color(hex_rgb: str, alpha: int = 0) -> str:
    h = hex_rgb.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _ts(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(words: list[Word], clip_start: float, clip_end: float, style: CaptionStyle | None = None,
              out_w: int = 1080, out_h: int = 1920) -> str:
    st = style or CaptionStyle()
    align, margin_frac = POSITIONS.get(st.position, POSITIONS["bottom"])
    margin_v = int(out_h * margin_frac)
    border_style = 3 if st.box else 1
    back = _ass_color("#000000", 0x60) if st.box else _ass_color("#000000", 0x80)
    header = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {out_w}\nPlayResY: {out_h}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Cap,{st.font},{st.font_size},"
        f"{_ass_color(st.highlight if st.mode == 'karaoke' else st.color)},{_ass_color(st.color)},"
        f"{_ass_color(st.outline_color)},{back},{-1 if st.bold else 0},0,0,0,100,100,0,0,{border_style},"
        f"{st.outline},{st.shadow},{align},90,90,{margin_v},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    inside = [Word(text=w.text, start=max(w.start, clip_start) - clip_start, end=min(w.end, clip_end) - clip_start,
                   conf=w.conf, speaker=w.speaker, approx=w.approx)
              for w in words if w.end > clip_start and w.start < clip_end and w.text.strip()]
    emph = {ar.normalize(ar.strip_edges(e)) for e in st.emphasis}
    lines: list[str] = []

    def fmt_word(w: Word) -> str:
        t = _esc(w.text)
        if ar.normalize(ar.strip_edges(w.text)) in emph:
            return "{\\b1\\fscx112\\fscy112}" + t + "{\\fscx100\\fscy100}"
        return t

    if st.mode == "pop":
        for w in inside:
            lines.append(f"Dialogue: 0,{_ts(w.start)},{_ts(max(w.end, w.start + 0.25))},Cap,,0,0,0,,"
                         f"{{\\fscx115\\fscy115}}{_esc(w.text)}")
        return header + "\n".join(lines) + "\n"

    for ev in ar.chunk_words_for_captions(inside, max_chars=st.max_chars_per_line):
        rows = ar.split_two_lines(ev, st.max_chars_per_line)
        start = ev[0].start
        end = max(ev[-1].end, start + 0.4)
        parts: list[str] = []
        for ri, row in enumerate(rows):
            if st.mode == "karaoke":
                toks = []
                for w in row:
                    cs = max(1, int(round((w.end - w.start) * 100)))
                    toks.append(f"{{\\k{cs}}}{fmt_word(w)}")
                parts.append(" ".join(toks))
            else:
                parts.append(" ".join(fmt_word(w) for w in row))
        lines.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Cap,,0,0,0,," + "\\N".join(parts))
    return header + "\n".join(lines) + "\n"

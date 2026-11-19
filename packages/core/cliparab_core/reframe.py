"""Reframing: turn a subject track into a smooth 9:16 crop path and FFmpeg filters.

The crop window never jitters: a dead-zone ignores small movements, a speed limit
prevents whip-pans and an exponential filter smooths the rest. The path is exported as
a piecewise-linear FFmpeg expression so a single encode pass renders it.
"""

from __future__ import annotations

from dataclasses import dataclass

OUT_W, OUT_H = 1080, 1920


@dataclass
class CropGeometry:
    src_w: int
    src_h: int
    crop_w: int
    crop_h: int
    horizontal: bool  # True: crop width (and pan on x); False: crop height (and pan on y)


def _even(v: float) -> int:
    return max(2, int(v) // 2 * 2)


def crop_geometry(src_w: int, src_h: int, aspect: float = 9 / 16) -> CropGeometry:
    if src_w / src_h > aspect:
        return CropGeometry(src_w, src_h, _even(src_h * aspect), _even(src_h), True)
    return CropGeometry(src_w, src_h, _even(src_w), _even(src_w / aspect), False)


def smooth_path(track: list[tuple[float, float]], geo: CropGeometry, deadzone: float = 0.06,
                max_speed: float = 0.5, alpha: float = 0.35, step: float = 0.5) -> list[tuple[float, float]]:
    """Return ``[(t, pos_px)]`` keyframes for the crop's top-left coordinate along the pan axis."""
    span = (geo.src_w - geo.crop_w) if geo.horizontal else (geo.src_h - geo.crop_h)
    win = geo.crop_w if geo.horizontal else geo.crop_h
    if span <= 0 or not track:
        return [(0.0, 0.0)]
    full = geo.src_w if geo.horizontal else geo.src_h
    pts = sorted(track)
    cur = min(max(pts[0][1] * full - win / 2, 0), span)
    out = [(pts[0][0], cur)]
    for (t0, _), (t1, cx) in zip(pts, pts[1:]):
        dt = max(t1 - t0, 1e-3)
        want = min(max(cx * full - win / 2, 0), span)
        if abs(want - cur) > deadzone * win:
            target = cur + alpha * (want - cur)
            lim = max_speed * win * dt
            cur += max(-lim, min(lim, target - cur))
        out.append((t1, cur))
    return out


def lerp_expr(keys: list[tuple[float, float]], var: str = "t") -> str:
    """Piecewise-linear FFmpeg expression (commas escaped for use in a filtergraph)."""
    if len(keys) == 1:
        return f"{keys[0][1]:.1f}"
    expr = f"{keys[-1][1]:.1f}"
    for (t0, v0), (t1, v1) in reversed(list(zip(keys, keys[1:]))):
        seg = f"{v0:.1f}+({v1 - v0:.2f})*({var}-{t0:.3f})/{max(t1 - t0, 1e-3):.3f}"
        expr = f"if(lt({var}\\,{t1:.3f})\\,{seg}\\,{expr})"
    return expr


def build_video_graph(layout: str, geo: CropGeometry, keys: list[tuple[float, float]], ass_name: str | None,
                      fonts_dir: str | None = None, split_centers: tuple[float, float] | None = None,
                      out_w: int = OUT_W, out_h: int = OUT_H) -> str:
    """Return a ``filter_complex`` graph ending in label ``[v]``."""
    sub = ""
    if ass_name:
        sub = f",ass={ass_name}" + (f":fontsdir={fonts_dir}" if fonts_dir else "")
    if layout == "fit":
        return (f"[0:v]split=2[a][b];[a]scale={out_w}:{out_h}:force_original_aspect_ratio=increase,"
                f"crop={out_w}:{out_h},boxblur=30:5,eq=brightness=-0.08[bg];[b]scale={out_w}:-2[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1{sub}[v]")
    if layout == "split" and split_centers:
        half_h = out_h // 2
        cw = _even(min(geo.src_w, geo.src_h * out_w / half_h))
        ch = _even(cw * half_h / out_w)

        def x_of(c: float) -> int:
            return int(min(max(c * geo.src_w - cw / 2, 0), geo.src_w - cw))
        y = int(max((geo.src_h - ch) / 2, 0))
        return (f"[0:v]split=2[a][b];[a]crop={cw}:{ch}:{x_of(split_centers[0])}:{y},scale={out_w}:{half_h}[top];"
                f"[b]crop={cw}:{ch}:{x_of(split_centers[1])}:{y},scale={out_w}:{half_h}[bot];"
                f"[top][bot]vstack,setsar=1{sub}[v]")
    # fill (default): moving crop window then scale
    pos = lerp_expr(keys)
    if geo.horizontal:
        crop = f"crop={geo.crop_w}:{geo.crop_h}:x='{pos}':y=0"
    else:
        crop = f"crop={geo.crop_w}:{geo.crop_h}:x=0:y='{pos}'"
    return f"[0:v]{crop},scale={out_w}:{out_h}:flags=lanczos,setsar=1{sub}[v]"

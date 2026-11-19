"""FFmpeg/ffprobe helpers and light-weight vision (subject tracking for reframing)."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import numpy as np


class MediaError(RuntimeError):
    pass


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    p = subprocess.run(cmd, capture_output=True, **kw)
    if p.returncode != 0:
        raise MediaError(f"{cmd[0]} failed ({p.returncode}): {p.stderr.decode(errors='replace')[-800:]}")
    return p


def probe(path: str) -> dict:
    out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]).stdout
    d = json.loads(out)
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not v:
        raise MediaError("no video stream found")
    num, _, den = (v.get("avg_frame_rate") or "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"]) % 360
    if rot in (90, 270):
        w, h = h, w
    return {"duration": float(d["format"].get("duration") or v.get("duration") or 0), "width": w, "height": h,
            "fps": round(fps, 3), "has_audio": a is not None, "video_codec": v.get("codec_name"),
            "audio_codec": a.get("codec_name") if a else None, "rotation": rot,
            "size_bytes": int(d["format"].get("size") or 0)}


def extract_audio(src: str, out_wav: str, denoise: bool = False) -> str:
    af = ["-af", "highpass=f=80,afftdn=nf=-25"] if denoise else []
    _run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", *af, "-c:a", "pcm_s16le", out_wav])
    return out_wav


def make_proxy(src: str, out: str, height: int = 360) -> str:
    _run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"scale=-2:{height}", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "28", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", out])
    return out


def rms_db_per_window(audio_path: str, window: float = 0.5) -> list[float]:
    """Loudness (dBFS) per ``window`` seconds from a 16 kHz mono wav/any audio."""
    raw = _run(["ffmpeg", "-v", "error", "-i", audio_path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"]).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    n = int(16000 * window)
    if len(x) < n:
        return []
    frames = x[: len(x) // n * n].reshape(-1, n)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    return [float(v) for v in 20 * np.log10(rms + 1e-9)]


def extract_frame(src: str, t: float, out_jpg: str, width: int = 540) -> str:
    _run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", src, "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", out_jpg])
    return out_jpg


# --------------------------------------------------------------------------- subject tracking
def track_subject(src: str, start: float, end: float, step: float = 0.5, mode: str | None = None) -> list[tuple[float, float]]:
    """Return ``[(t_relative, cx_normalised)]`` for the main subject.

    ``mode``: ``face`` (MediaPipe Tasks, needs ``FACE_MODEL_PATH``), ``motion`` (frame-difference
    centroid, no models) or ``center``. ``None`` picks face if configured, else motion.
    """
    mode = mode or ("face" if os.getenv("FACE_MODEL_PATH") else "motion")
    if mode == "center":
        return [(0.0, 0.5), (max(end - start, step), 0.5)]
    try:
        import cv2  # noqa: F401
    except ImportError:
        return [(0.0, 0.5), (max(end - start, step), 0.5)]
    if mode == "face":
        try:
            return _track_faces(src, start, end, step)
        except Exception:  # noqa: BLE001 - fall back silently to motion tracking
            pass
    return _track_motion(src, start, end, step)


def _read_gray(cap, t: float, width: int = 160):
    import cv2

    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok:
        return None
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (width, max(1, int(h * width / w))))
    return cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)


def _track_motion(src: str, start: float, end: float, step: float) -> list[tuple[float, float]]:
    import cv2

    cap = cv2.VideoCapture(src)
    out: list[tuple[float, float]] = []
    last = 0.5
    t = start
    while t <= end + 1e-6:
        a, b = _read_gray(cap, t), _read_gray(cap, t + 0.25)
        cx = last
        if a is not None and b is not None and a.shape == b.shape:
            diff = cv2.absdiff(a, b).astype(np.float32)
            diff[diff < 12] = 0
            col = diff.sum(axis=0)
            if col.sum() > diff.size * 0.4:
                cx = float((col * np.arange(len(col))).sum() / col.sum() / (len(col) - 1))
        out.append((round(t - start, 3), cx))
        last = cx
        t += step
    cap.release()
    return out or [(0.0, 0.5)]


def _track_faces(src: str, start: float, end: float, step: float) -> list[tuple[float, float]]:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision

    opts = vision.FaceDetectorOptions(base_options=mpt.BaseOptions(model_asset_path=os.environ["FACE_MODEL_PATH"]),
                                      min_detection_confidence=0.5)
    det = vision.FaceDetector.create_from_options(opts)
    cap = cv2.VideoCapture(src)
    out: list[tuple[float, float]] = []
    last = 0.5
    t = start
    while t <= end + 1e-6:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        cx = last
        if ok:
            res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
            if res.detections:
                best = max(res.detections, key=lambda d: d.bounding_box.width * d.bounding_box.height)
                bb = best.bounding_box
                cx = (bb.origin_x + bb.width / 2) / frame.shape[1]
        out.append((round(t - start, 3), float(cx)))
        last = cx
        t += step
    cap.release()
    return out

"""OpenAI Whisper API (whisper-1) for machines without a GPU.

The API limits uploads to 25 MB, so audio is sent as 16 kHz mono Opus/OGG in chunks
of ``chunk_seconds`` and word timestamps are re-offset to the original timeline.
"""

from __future__ import annotations

import json
import mimetypes
import os
import subprocess
import tempfile
import urllib.request
import uuid
from pathlib import Path

from ..models import Segment, Transcript, Word

URL = "https://api.openai.com/v1/audio/transcriptions"


def _multipart(fields: dict[str, str | list[str]], file_field: str, file_path: str) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for k, v in fields.items():
        for item in (v if isinstance(v, list) else [v]):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{item}\r\n'.encode())
    ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
                 f'filename="{Path(file_path).name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode())
    parts.append(Path(file_path).read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


class OpenAIWhisperTranscriber:
    name = "openai-whisper"

    def __init__(self, api_key: str | None = None, chunk_seconds: int = 600, model: str = "whisper-1"):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.chunk_seconds = chunk_seconds
        self.model = model
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")

    def _one(self, path: str, language: str | None) -> dict:
        fields: dict[str, str | list[str]] = {"model": self.model, "response_format": "verbose_json",
                                              "timestamp_granularities[]": ["word", "segment"]}
        if language:
            fields["language"] = language
        body, ctype = _multipart(fields, "file", path)
        req = urllib.request.Request(URL, data=body, method="POST",
                                     headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": ctype})
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read())

    def transcribe(self, audio_path: str, language: str | None = "ar") -> Transcript:
        segments: list[Segment] = []
        duration = float(subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio_path]).strip() or 0)
        with tempfile.TemporaryDirectory() as td:
            offset = 0.0
            while offset < duration:
                chunk = str(Path(td) / f"c{int(offset)}.ogg")
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(offset), "-t", str(self.chunk_seconds), "-i", audio_path,
                                "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", chunk], check=True)
                data = self._one(chunk, language)
                words_raw = data.get("words", [])
                for s in data.get("segments", []):
                    ws = [Word(text=w["word"].strip(), start=w["start"] + offset, end=w["end"] + offset)
                          for w in words_raw if s["start"] - 0.01 <= w["start"] <= s["end"] + 0.01 and w["word"].strip()]
                    if not ws:
                        continue
                    segments.append(Segment(id=len(segments), start=s["start"] + offset, end=s["end"] + offset,
                                            text=s["text"].strip(), words=ws))
                offset += self.chunk_seconds
        return Transcript(language=language or "ar", segments=segments, engine=f"openai:{self.model}", duration=duration)

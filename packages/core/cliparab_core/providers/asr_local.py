"""Local Whisper via faster-whisper (CTranslate2). Install the ``whisper`` extra."""

from __future__ import annotations

import os

from ..models import Segment, Transcript, Word


class FasterWhisperTranscriber:
    name = "faster-whisper"

    def __init__(self, model_size: str | None = None, device: str | None = None, compute_type: str | None = None):
        self.model_size = model_size or os.getenv("WHISPER_MODEL", "large-v3")
        self.device = device or os.getenv("WHISPER_DEVICE", "auto")
        self.compute_type = compute_type or os.getenv("WHISPER_COMPUTE", "default")
        self._model = None

    def _load(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as e:  # pragma: no cover
                raise RuntimeError("faster-whisper is not installed: pip install 'cliparab-core[whisper]'") from e
            self._model = WhisperModel(self.model_size, device=self.device, compute_type=self.compute_type)
        return self._model

    def transcribe(self, audio_path: str, language: str | None = "ar") -> Transcript:
        model = self._load()
        seg_iter, info = model.transcribe(audio_path, language=language, word_timestamps=True, vad_filter=True,
                                          vad_parameters={"min_silence_duration_ms": 400},
                                          condition_on_previous_text=False, beam_size=5)
        segments: list[Segment] = []
        for s in seg_iter:
            words = [Word(text=w.word.strip(), start=float(w.start), end=float(w.end), conf=float(w.probability))
                     for w in (s.words or []) if w.word.strip()]
            if not words:
                continue
            segments.append(Segment(id=len(segments), start=float(s.start), end=float(s.end), text=s.text.strip(),
                                    words=words, conf=sum(w.conf for w in words) / len(words)))
        return Transcript(language=info.language, segments=segments, engine=f"faster-whisper:{self.model_size}",
                          duration=float(info.duration))

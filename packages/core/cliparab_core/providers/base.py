"""Provider interfaces."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..models import Transcript


class Transcriber(Protocol):
    name: str

    def transcribe(self, audio_path: str, language: str | None = "ar") -> Transcript: ...


@dataclass
class ClipJudgement:
    """LLM (or heuristic) judgement of one candidate. Scores are in [0, 1]."""

    id: int
    hook: float
    completeness: float
    value: float
    fresh_viewer_ok: bool = True  # would a viewer who saw only this clip understand it?
    dangling_reference: bool = False
    clip_type: str = "educational"
    title: str = ""
    reason_ar: str = ""
    hooks: list[dict[str, str]] = field(default_factory=list)
    emphasis: list[str] = field(default_factory=list)
    suggested_start_shift: int = 0  # in sentences, negative = start earlier
    suggested_end_shift: int = 0


class LLMProvider(Protocol):
    name: str

    def judge(self, items: list[dict]) -> list[ClipJudgement]:
        """``items`` are ``{"id": int, "text": str, "duration": float}`` dicts."""
        ...

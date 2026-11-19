"""Data classes shared by all pipeline stages. Times are seconds (float)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Word:
    text: str
    start: float
    end: float
    conf: float = 1.0
    speaker: str | None = None
    approx: bool = False  # True when timing was interpolated (e.g. imported SRT)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Word":
        return cls(**{k: d[k] for k in ("text", "start", "end") if k in d},
                   conf=d.get("conf", 1.0), speaker=d.get("speaker"), approx=d.get("approx", False))


@dataclass
class Segment:
    id: int
    start: float
    end: float
    text: str
    words: list[Word] = field(default_factory=list)
    speaker: str | None = None
    conf: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["words"] = [w.to_dict() for w in self.words]
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Segment":
        return cls(id=d["id"], start=d["start"], end=d["end"], text=d["text"],
                   words=[Word.from_dict(w) for w in d.get("words", [])],
                   speaker=d.get("speaker"), conf=d.get("conf", 1.0))


@dataclass
class Transcript:
    language: str
    segments: list[Segment]
    engine: str = "unknown"
    dialect: str | None = None
    duration: float = 0.0

    def words(self) -> list[Word]:
        return [w for s in self.segments for w in s.words]

    @property
    def avg_conf(self) -> float:
        ws = self.words()
        return sum(w.conf for w in ws) / len(ws) if ws else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {"language": self.language, "engine": self.engine, "dialect": self.dialect,
                "duration": self.duration, "segments": [s.to_dict() for s in self.segments]}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Transcript":
        return cls(language=d["language"], engine=d.get("engine", "unknown"), dialect=d.get("dialect"),
                   duration=d.get("duration", 0.0), segments=[Segment.from_dict(s) for s in d["segments"]])


@dataclass
class Sentence:
    id: int
    start: float
    end: float
    text: str
    words: list[Word]
    speaker: str | None = None

    @property
    def duration(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "start": self.start, "end": self.end, "text": self.text,
                "speaker": self.speaker, "words": [w.to_dict() for w in self.words]}


@dataclass
class Candidate:
    """A proposed clip. ``scores`` holds the six ClipScore components in [0, 1]."""

    start: float
    end: float
    first_sentence: int
    last_sentence: int
    clip_type: str = "educational"
    scores: dict[str, float] = field(default_factory=dict)
    penalties: dict[str, float] = field(default_factory=dict)
    total: float = 0.0
    reason_ar: str = ""
    title: str = ""
    hooks: list[dict[str, str]] = field(default_factory=list)
    emphasis: list[str] = field(default_factory=list)
    speakers: list[str] = field(default_factory=list)
    chapter: int = 0
    text: str = ""
    flags: list[str] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["duration"] = round(self.duration, 3)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Candidate":
        known = {k: d[k] for k in cls.__dataclass_fields__ if k in d}
        return cls(**known)


CLIP_TYPES = ("viral", "educational", "opinion", "story", "comedy", "quote", "short", "marketing")

CLIP_TYPE_LABELS_AR = {
    "viral": "الأكثر قابلية للانتشار",
    "educational": "تعليمي",
    "opinion": "رأي",
    "story": "قصة",
    "comedy": "كوميدي",
    "quote": "اقتباس",
    "short": "قصير جدًا",
    "marketing": "مناسب لإعلان أو تسويق",
}

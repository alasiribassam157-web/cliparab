"""End-to-end orchestration. Every stage saves its output and is skipped if already done."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import media, text_ar as ar
from .candidates import CandidateConfig, generate_candidates
from .models import Candidate, Sentence, Transcript, Word
from .providers import HeuristicLLM, get_llm
from .providers.base import LLMProvider, Transcriber
from .render import EditState, render_clip
from .scoring import ScoringConfig, build_context, diversify, passes_hard_filters, score_candidate
from .subtitles import parse_subtitles
from .topics import segment_topics

log = logging.getLogger(__name__)
ProgressFn = Callable[[str, float], None]


@dataclass
class AnalyzeOptions:
    language: str = "ar"
    max_clips: int = 12
    min_duration: float = 15.0
    max_duration: float = 60.0
    denoise: bool = False
    candidate: CandidateConfig = field(default_factory=CandidateConfig)
    scoring: ScoringConfig = field(default_factory=ScoringConfig)


class Project:
    """A working directory holding all artifacts of one source video."""

    def __init__(self, workdir: str | Path):
        self.dir = Path(workdir)
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, name: str) -> Path:
        return self.dir / name

    def save(self, name: str, obj) -> None:
        self.path(name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

    def load(self, name: str):
        return json.loads(self.path(name).read_text(encoding="utf-8"))

    def has(self, name: str) -> bool:
        return self.path(name).exists()


def analyze(source: str, project: Project, transcriber: Transcriber | None = None, subtitles: str | None = None,
            llm: LLMProvider | None = None, opts: AnalyzeOptions | None = None, force: bool = False,
            progress: ProgressFn | None = None) -> list[Candidate]:
    opts = opts or AnalyzeOptions()
    opts.candidate.min_duration, opts.candidate.max_duration = opts.min_duration, opts.max_duration
    report = progress or (lambda stage, p: None)

    # 1) probe
    report("probe", 0.0)
    if force or not project.has("probe.json"):
        project.save("probe.json", media.probe(source))
    info = project.load("probe.json")

    # 2) transcript: imported subtitles need no ASR and no audio extraction
    report("transcribe", 0.1)
    if force or not project.has("transcript.json"):
        if subtitles:
            tr = parse_subtitles(Path(subtitles).read_text(encoding="utf-8-sig"), opts.language)
            tr.duration = info["duration"]
        else:
            if transcriber is None:
                raise ValueError("provide a transcriber or a subtitles file")
            if not info["has_audio"]:
                raise media.MediaError("the video has no audio track")
            wav = str(project.path("audio.wav"))
            if force or not Path(wav).exists():
                media.extract_audio(source, wav, opts.denoise)
            tr = transcriber.transcribe(wav, opts.language)
        project.save("transcript.json", tr.to_dict())
    tr = Transcript.from_dict(project.load("transcript.json"))
    if not tr.words():
        raise ValueError("transcript is empty: nothing to analyse")

    # 3) sentences + chapters
    report("segment", 0.4)
    sentences = ar.split_sentences(tr.words())
    chapters = segment_topics(sentences)

    # 4) candidates + scoring
    report("score", 0.5)
    if force or not project.has("suggestions.json"):
        cands = generate_candidates(sentences, opts.candidate, duration=info["duration"])
        for c in cands:
            c.chapter = chapters[c.first_sentence]
        llm = llm or get_llm()
        # pre-rank with heuristics so we only pay LLM cost for the promising ~40 candidates
        ctx = build_context(sentences, tr.words(), chapters)
        pre = [score_candidate(c, sentences, None, ctx, opts.scoring) for c in cands]
        shortlist = sorted(pre, key=lambda c: -c.total)[: max(opts.max_clips * 4, 24)]
        shortlist = diversify(shortlist, opts.scoring, limit=len(shortlist))  # drop near-duplicates before paying
        items = [{"id": i, "text": c.text, "duration": c.duration} for i, c in enumerate(shortlist)]
        judged = llm.judge(items)
        rms = None
        if project.has("audio.wav"):
            try:
                rms = media.rms_db_per_window(str(project.path("audio.wav")))
            except media.MediaError:
                rms = None
        final: list[Candidate] = []
        for c, j in zip(shortlist, judged):
            win = None
            if rms:
                a, b = int(c.start / 0.5), int(c.end / 0.5)
                win = rms[a:b] or None
            score_candidate(c, sentences, j, ctx, opts.scoring, rms_db=win)
            if passes_hard_filters(c, opts.scoring):
                final.append(c)
        picked = diversify(final, opts.scoring, limit=opts.max_clips)
        out = []
        for rank, c in enumerate(picked, 1):
            d = c.to_dict()
            d.update({"id": f"c{rank:02d}", "rank": rank, "engine": getattr(llm, "name", "unknown")})
            out.append(d)
        project.save("suggestions.json", out)
    report("done", 1.0)
    return [Candidate.from_dict(d) for d in project.load("suggestions.json")]


def render(source: str, project: Project, clip_id: str, edit: dict | None = None, out_name: str | None = None,
           on_progress: Callable[[float], None] | None = None) -> dict:
    sug = {d["id"]: d for d in project.load("suggestions.json")}
    if clip_id not in sug:
        raise KeyError(f"unknown clip {clip_id}")
    base = {"start": sug[clip_id]["start"], "end": sug[clip_id]["end"],
            "caption": {"emphasis": sug[clip_id].get("emphasis", [])}}
    base.update(edit or {})
    es = EditState.from_dict(base)
    tr = Transcript.from_dict(project.load("transcript.json"))
    out = project.path(out_name or f"{clip_id}.mp4")
    return render_clip(source, es, tr.words(), str(out), str(project.path(f"render_{clip_id}")), on_progress=on_progress,
                       probe=project.load("probe.json"))

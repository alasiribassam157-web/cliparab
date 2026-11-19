"""Candidate clip generation with boundary repair.

Instead of cutting at fixed lengths, candidates start and end on sentence boundaries.
Starts that open with a dangling reference are repaired by pulling in the previous
sentence(s); ends that stop mid-thought are extended. Candidates that cannot be repaired
inside the duration limits are dropped later by the hard filters in ``scoring``.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import text_ar as ar
from .models import Candidate, Sentence


@dataclass
class CandidateConfig:
    min_duration: float = 15.0
    max_duration: float = 60.0
    target_durations: tuple[float, ...] = (20.0, 30.0, 45.0, 58.0)
    max_ends_per_start: int = 3
    max_back_repair: int = 2     # sentences we may pull in to fix a dangling start
    max_forward_repair: int = 2  # sentences we may add to fix an incomplete end
    pad_before: float = 0.15
    pad_after: float = 0.25


def _text(sentences: list[Sentence], i: int, j: int) -> str:
    return " ".join(s.text for s in sentences[i: j + 1])


def generate_candidates(sentences: list[Sentence], cfg: CandidateConfig | None = None,
                        duration: float | None = None) -> list[Candidate]:
    cfg = cfg or CandidateConfig()
    n = len(sentences)
    seen: set[tuple[int, int]] = set()
    out: list[Candidate] = []

    for i0 in range(n):
        i = i0
        flags: list[str] = []
        # --- repair the start
        back = 0
        while (ar.starts_dangling(sentences[i].text) and i > 0 and back < cfg.max_back_repair
               and sentences[i - 1].duration < 15):
            i -= 1
            back += 1
        if back:
            flags.append(f"start_repaired:{back}")

        picks: list[tuple[float, int]] = []
        for j in range(i, n):
            dur = sentences[j].end - sentences[i].start
            if dur < cfg.min_duration:
                continue
            if dur > cfg.max_duration:
                break
            score = ar.conclusion_strength(sentences[j].text)
            target_fit = min(abs(dur - t) for t in cfg.target_durations) / 30.0
            picks.append((score - 0.3 * target_fit, j))
        picks.sort(reverse=True)

        for _, j in picks[: cfg.max_ends_per_start]:
            jj = j
            fwd = 0
            while ar.ends_incomplete(sentences[jj].text) and jj + 1 < n and fwd < cfg.max_forward_repair \
                    and sentences[jj + 1].end - sentences[i].start <= cfg.max_duration:
                jj += 1
                fwd += 1
            key = (i, jj)
            if key in seen:
                continue
            seen.add(key)
            a = max(0.0, sentences[i].start - cfg.pad_before)
            b = sentences[jj].end + cfg.pad_after
            if duration:
                b = min(b, duration)
            f = list(flags)
            if fwd:
                f.append(f"end_repaired:{fwd}")
            c = Candidate(start=round(a, 3), end=round(b, 3), first_sentence=i, last_sentence=jj,
                          text=_text(sentences, i, jj), flags=f,
                          speakers=sorted({s.speaker for s in sentences[i: jj + 1] if s.speaker}))
            out.append(c)
    return out

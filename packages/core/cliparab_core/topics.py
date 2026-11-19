"""Lexical topic segmentation (TextTiling-style) used for chapters and diversity.

No embeddings are required: sentence windows are compared with cosine similarity over
normalised content words, and chapter boundaries are placed at similarity valleys.
Embedding-based segmentation can replace ``segment_topics`` without API changes.
"""

from __future__ import annotations

import math
from collections import Counter

from . import text_ar as ar
from .models import Sentence


def light_stem(t: str) -> str:
    """Very light Arabic stemming: strip a conjunction/article/preposition prefix and common suffixes."""
    for pre in ("وال", "بال", "لل", "فال", "كال", "ال", "و", "ب", "ل"):
        if t.startswith(pre) and len(t) - len(pre) >= 3:
            t = t[len(pre):]
            break
    for suf in ("ات", "ون", "ين", "ان", "ه", "ها", "هم", "ي"):
        if t.endswith(suf) and len(t) - len(suf) >= 3:
            t = t[: -len(suf)]
            break
    return t


def _bag(sentences: list[Sentence]) -> Counter:
    c: Counter = Counter()
    for s in sentences:
        for t in ar.norm_tokens(s.text):
            if t not in ar._STOPWORDS and len(t) > 2:
                c[light_stem(t)] += 1
    return c


def _cos(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0


def segment_topics(sentences: list[Sentence], window: int = 4, min_chapter_sentences: int = 4,
                   min_chapter_seconds: float = 40.0) -> list[int]:
    """Return a chapter index per sentence."""
    n = len(sentences)
    if n <= min_chapter_sentences * 2:
        return [0] * n
    sims = []
    for i in range(1, n):
        left = _bag(sentences[max(0, i - window): i])
        right = _bag(sentences[i: i + window])
        sims.append(_cos(left, right))
    mean = sum(sims) / len(sims)
    sd = math.sqrt(sum((x - mean) ** 2 for x in sims) / len(sims)) or 1e-9
    cutoff = mean - 0.5 * sd
    boundaries = [0]
    for k in range(1, len(sims) - 1):
        i = k + 1  # boundary before sentence i
        if sims[k] < cutoff and sims[k] <= sims[k - 1] and sims[k] <= sims[k + 1] \
                and i - boundaries[-1] >= min_chapter_sentences and n - i >= min_chapter_sentences \
                and sentences[i].start - sentences[boundaries[-1]].start >= min_chapter_seconds:
            boundaries.append(i)
    chapters = []
    ch = 0
    bset = set(boundaries[1:])
    for i in range(n):
        if i in bset:
            ch += 1
        chapters.append(ch)
    return chapters

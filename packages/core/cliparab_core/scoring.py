"""ClipScore: transparent scoring, hard filters and diversification.

    ClipScore = clip( 20*Hook + 25*Complete + 20*Value + 10*Audio + 10*Visual
                      + 15*Engage - Penalties , 0, 100 )

Each component is in [0, 1]; weights are the maximum points. Every candidate keeps its
full breakdown so the UI can answer "why was this clip suggested?". LLM judgements are
blended with the deterministic heuristics so a single bad model answer cannot promote a
clip that fails an objective check (dangling start, cut-off ending, unintelligible audio).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import text_ar as ar
from .models import Candidate, Sentence, Word
from .providers.base import ClipJudgement

WEIGHTS = {"hook": 20.0, "complete": 25.0, "value": 20.0, "audio": 10.0, "visual": 10.0, "engage": 15.0}
MAX_PENALTY = 40.0


@dataclass
class ScoringConfig:
    llm_weight: float = 0.65          # blend of LLM vs heuristic for hook/complete/value
    min_speech_ratio: float = 0.45
    min_asr_conf: float = 0.55
    min_total: float = 40.0
    max_overlap: float = 0.30
    mmr_lambda: float = 0.75
    same_chapter_penalty: float = 0.08
    engage_cap: float = 0.8           # anti-loudness bias: engagement can never reach 1.0
    weights: dict[str, float] = field(default_factory=lambda: dict(WEIGHTS))


# ------------------------------------------------------------------ audio / engagement features
def speech_ratio(words: list[Word], start: float, end: float) -> float:
    dur = max(end - start, 1e-6)
    spoken = sum(max(0.0, min(w.end, end) - max(w.start, start)) for w in words if w.end > start and w.start < end)
    return min(1.0, spoken / dur)


def max_internal_pause(words: list[Word]) -> float:
    return max((b.start - a.end for a, b in zip(words, words[1:])), default=0.0)


def speaking_rate(words: list[Word]) -> float:
    if len(words) < 2:
        return 0.0
    return len(words) / max(words[-1].end - words[0].start, 1e-6)


def zscore(value: float, population: list[float]) -> float:
    if len(population) < 3:
        return 0.0
    m = sum(population) / len(population)
    sd = math.sqrt(sum((x - m) ** 2 for x in population) / len(population))
    sd = max(sd, 0.1 * abs(m), 1e-6)  # floor: near-uniform populations must not explode z-scores
    return max(-3.0, min(3.0, (value - m) / sd))


def _sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-max(-30.0, min(30.0, z))))


def build_context(sentences: list[Sentence], all_words: list[Word], chapters: list[int] | None = None,
                  window: float = 20.0) -> dict:
    """Per-speaker pace populations for z-scoring (anti-loudness bias) and the chapter map.

    Pace is measured over sliding ``window``-second spans, the same way it is measured for a
    clip, so a clip is only ever compared with *its own speaker's* normal pace.
    """
    by_speaker: dict[str | None, list[float]] = {}
    spk = {s.speaker for s in sentences}
    for sp in spk:
        ws = [w for w in all_words if w.speaker == sp]
        if len(ws) < 2:
            continue
        t, end = ws[0].start, ws[-1].end
        pop: list[float] = []
        while t + window <= end + 1e-6:
            chunk = [w for w in ws if w.start >= t and w.end <= t + window]
            if len(chunk) >= 5:
                pop.append(len(chunk) / window)
            t += window / 2
        by_speaker[sp] = pop
    return {"rates": by_speaker, "chapters": chapters or [0] * len(sentences)}


def score_candidate(c: Candidate, sentences: list[Sentence], judge: ClipJudgement | None, ctx: dict,
                    cfg: ScoringConfig, rms_db: list[float] | None = None, visual: float | None = None) -> Candidate:
    sents = sentences[c.first_sentence: c.last_sentence + 1]
    words = [w for s in sents for w in s.words]
    first, last = sents[0].text, sents[-1].text

    # --- heuristics
    h_hook = ar.hook_strength(first, sents[1].text if len(sents) > 1 else "")
    h_complete = 0.0 if ar.starts_dangling(c.text) else 0.55
    h_complete += 0.45 * ar.conclusion_strength(last)
    h_value = ar.value_strength(c.text)

    if judge:
        w = cfg.llm_weight
        hook = w * judge.hook + (1 - w) * h_hook
        complete = w * judge.completeness + (1 - w) * min(1.0, h_complete)
        value = w * judge.value + (1 - w) * h_value
        c.clip_type, c.title, c.reason_ar = judge.clip_type, judge.title, judge.reason_ar
        c.hooks, c.emphasis = judge.hooks, judge.emphasis or ar.emphasis_words(c.text)
    else:
        hook, complete, value = h_hook, min(1.0, h_complete), h_value
        c.clip_type = ar.classify_clip(c.text, c.duration, h_hook, first)
        c.emphasis = ar.emphasis_words(c.text)

    # --- audio quality: speech density, ASR confidence, long dead air
    sr = speech_ratio(words, c.start, c.end)
    conf = sum(w.conf for w in words) / len(words) if words else 0.0
    pause = max_internal_pause(words)
    audio = 0.5 * min(1.0, sr / 0.85) + 0.4 * conf + 0.1 * (1.0 if pause < 1.5 else 0.0)
    audio -= 0.25 if pause > 3.0 else 0.0
    audio = max(0.0, min(1.0, audio))

    # --- engagement: pace vs the speaker's own baseline (z-score), small cap
    rate = len(words) / max(c.duration, 1e-6)
    pop = ctx["rates"].get(sents[0].speaker, [])
    z = zscore(rate, pop)
    engage = _sigmoid(0.9 * z)
    if rms_db:
        loud = _sigmoid(0.7 * zscore(sum(rms_db) / len(rms_db), rms_db))  # within-clip dynamics only
        engage = 0.7 * engage + 0.3 * loud
    engage = min(engage, cfg.engage_cap)

    vis = 0.6 if visual is None else max(0.0, min(1.0, visual))
    c.scores = {"hook": round(hook, 3), "complete": round(complete, 3), "value": round(value, 3),
                "audio": round(audio, 3), "visual": round(vis, 3), "engage": round(engage, 3)}

    # --- penalties (points)
    pen: dict[str, float] = {}
    if ar.ends_incomplete(last):
        pen["ends_mid_thought"] = 25.0
    if ar.starts_dangling(c.text):
        pen["dangling_start"] = 20.0
    if judge and (judge.dangling_reference or not judge.fresh_viewer_ok):
        pen["needs_context"] = 18.0
    if sr < cfg.min_speech_ratio:
        pen["low_speech_ratio"] = 15.0
    if conf < cfg.min_asr_conf and words:
        pen["low_asr_confidence"] = 15.0
    if c.duration < 12 or c.duration > 75:
        pen["bad_duration"] = 10.0
    else:  # soft preference for 20-50 s
        fit = (20 - c.duration) * 0.5 if c.duration < 20 else (c.duration - 50) * 0.8 if c.duration > 50 else 0.0
        if fit > 0:
            pen["duration_fit"] = round(min(fit, 8.0), 1)
    chap = ctx.get("chapters") or []
    if chap and len({chap[i] for i in range(c.first_sentence, c.last_sentence + 1)}) > 1:
        pen["crosses_topic"] = 15.0
    if any(ar.is_transition(s.text) for s in sents):
        pen["transition_phrase"] = 10.0
    c.penalties = pen

    raw = sum(cfg.weights[k] * v for k, v in c.scores.items()) - min(MAX_PENALTY, sum(pen.values()))
    c.total = round(max(0.0, min(100.0, raw)), 1)
    return c


def passes_hard_filters(c: Candidate, cfg: ScoringConfig) -> bool:
    """Objective rejections that no amount of 'virality' may override."""
    p = c.penalties
    if "dangling_start" in p and "needs_context" in p:
        return False
    if "low_speech_ratio" in p or "low_asr_confidence" in p:
        return False
    if "transition_phrase" in p:  # "thanks for watching" / "let's move on" never belongs inside a clip
        return False
    if "ends_mid_thought" in p and c.scores.get("complete", 0) < 0.5:
        return False
    return c.total >= cfg.min_total


def overlap_ratio(a: Candidate, b: Candidate) -> float:
    inter = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    return inter / max(min(a.duration, b.duration), 1e-6)


def diversify(cands: list[Candidate], cfg: ScoringConfig, limit: int = 12) -> list[Candidate]:
    """Greedy MMR selection: high score, low overlap, spread across chapters."""
    pool = sorted(cands, key=lambda c: -c.total)
    chosen: list[Candidate] = []
    while pool and len(chosen) < limit:
        best, best_val = None, -1e9
        for c in pool:
            if any(overlap_ratio(c, s) > cfg.max_overlap for s in chosen):
                continue
            red = max((overlap_ratio(c, s) for s in chosen), default=0.0)
            chap = cfg.same_chapter_penalty * sum(1 for s in chosen if s.chapter == c.chapter) * 100
            val = cfg.mmr_lambda * c.total - (1 - cfg.mmr_lambda) * 100 * red - chap
            if val > best_val:
                best, best_val = c, val
        if best is None:
            break
        chosen.append(best)
        pool.remove(best)
    return sorted(chosen, key=lambda c: -c.total)

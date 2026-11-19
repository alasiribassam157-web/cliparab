import json

import sample
from cliparab_core import text_ar as ar
from cliparab_core.candidates import generate_candidates
from cliparab_core.models import Candidate
from cliparab_core.providers import HeuristicLLM
from cliparab_core.providers.llm_claude import ClaudeLLM, _extract_json
from cliparab_core.scoring import (ScoringConfig, WEIGHTS, build_context, diversify, overlap_ratio,
                                   passes_hard_filters, score_candidate, zscore)
from cliparab_core.subtitles import parse_subtitles
from cliparab_core.topics import segment_topics


def _prep():
    tr = parse_subtitles(sample.make_srt())
    sents = ar.split_sentences(tr.words())
    ch = segment_topics(sents)
    cands = generate_candidates(sents)
    for c in cands:
        c.chapter = ch[c.first_sentence]
    return tr, sents, ch, cands


def test_candidates_start_and_end_on_sentence_boundaries_within_limits():
    _, sents, _, cands = _prep()
    assert cands
    for c in cands:
        assert 12 <= c.duration <= 66
        assert c.start <= sents[c.first_sentence].start and c.end >= sents[c.last_sentence].end
        assert not ar.ends_incomplete(sents[c.last_sentence].text)


def test_dangling_start_is_repaired_by_pulling_previous_sentence():
    _, sents, _, cands = _prep()
    idx = next(i for i, s in enumerate(sents) if s.text.startswith("هذا لا يحتاج"))
    repaired = [c for c in cands if c.first_sentence == idx - 1 or any(f.startswith("start_repaired") for f in c.flags)]
    assert repaired, "expected candidates that pull in the antecedent sentence"
    assert not any(c.first_sentence == idx and not c.flags for c in cands)


def test_scores_are_bounded_and_have_full_breakdown():
    tr, sents, ch, cands = _prep()
    cfg, ctx = ScoringConfig(), build_context(sents, tr.words(), ch)
    j = HeuristicLLM().judge([{"id": i, "text": c.text, "duration": c.duration} for i, c in enumerate(cands)])
    for c, jj in zip(cands, j):
        score_candidate(c, sents, jj, ctx, cfg)
        assert 0 <= c.total <= 100
        assert set(c.scores) == set(WEIGHTS)
        assert all(0 <= v <= 1 for v in c.scores.values())
        assert c.scores["engage"] <= cfg.engage_cap


def test_hard_filters_reject_unrecoverable_clips():
    tr, sents, ch, cands = _prep()
    cfg, ctx = ScoringConfig(), build_context(sents, tr.words(), ch)
    c = cands[0]
    score_candidate(c, sents, None, ctx, cfg)
    c.penalties["low_speech_ratio"] = 15.0
    assert not passes_hard_filters(c, cfg)


def test_diversify_removes_overlap_and_keeps_best():
    mk = lambda a, b, t: Candidate(start=a, end=b, first_sentence=0, last_sentence=0, total=t)
    cfg = ScoringConfig()
    chosen = diversify([mk(0, 30, 80), mk(5, 35, 79), mk(40, 70, 60), mk(100, 130, 50)], cfg)
    assert [c.total for c in chosen] == [80, 60, 50]
    assert all(overlap_ratio(a, b) <= cfg.max_overlap for a in chosen for b in chosen if a is not b)


def test_zscore_is_stable_for_uniform_populations():
    assert abs(zscore(1.0, [1.0, 1.0, 1.0, 1.0])) <= 3.0
    assert zscore(5.0, [1.0, 1.1, 0.9, 1.0]) == 3.0


def test_three_topics_give_three_distinct_clips():
    tr, sents, ch, cands = _prep()
    cfg, ctx = ScoringConfig(), build_context(sents, tr.words(), ch)
    j = HeuristicLLM().judge([{"id": i, "text": c.text, "duration": c.duration} for i, c in enumerate(cands)])
    for c, jj in zip(cands, j):
        score_candidate(c, sents, jj, ctx, cfg)
    top = diversify([c for c in cands if passes_hard_filters(c, cfg)], cfg, limit=6)
    assert len(top) >= 3
    assert not any(ar.is_transition(c.text) for c in top)
    assert not any(ar.starts_dangling(c.text) for c in top)


def test_claude_judge_parses_json_and_clamps(monkeypatch):
    llm = ClaudeLLM(api_key="k")
    payload = {"content": [{"type": "text", "text": "```json\n" + json.dumps({"results": [
        {"id": 0, "hook": 1.7, "completeness": 0.8, "value": "0.6", "fresh_viewer_ok": False, "dangling_reference": True,
         "type": "nonsense", "title": "عنوان", "reason_ar": "سبب", "hooks": [{"type": "question", "text": "هل؟"}],
         "emphasis": ["كلمة"], "start_shift": -1, "end_shift": 0}]}, ensure_ascii=False) + "\n```"}]}
    monkeypatch.setattr(llm, "_post", lambda p: payload)
    j = llm.judge([{"id": 0, "text": "نص", "duration": 20}])[0]
    assert j.hook == 1.0 and j.value == 0.6 and j.clip_type == "educational"
    assert j.dangling_reference and not j.fresh_viewer_ok and j.suggested_start_shift == -1


def test_claude_judge_falls_back_to_heuristic_on_failure(monkeypatch):
    llm = ClaudeLLM(api_key="k")

    def boom(_):
        raise RuntimeError("network down")
    monkeypatch.setattr(llm, "_post", boom)
    out = llm.judge([{"id": 7, "text": "هل تعرف لماذا يفشل الناس؟ لأنهم لا يبدؤون.", "duration": 20}])
    assert len(out) == 1 and out[0].id == 7 and 0 <= out[0].hook <= 1


def test_claude_requires_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    try:
        ClaudeLLM()
    except RuntimeError as e:
        assert "ANTHROPIC_API_KEY" in str(e)
    else:
        raise AssertionError("expected RuntimeError")


def test_extract_json_handles_fences_and_prose():
    assert _extract_json('here:\n```json\n{"results": []}\n```') == {"results": []}

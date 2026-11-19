"""Offline fallback judge: uses only the transparent Arabic heuristics.

It keeps the product usable with no API key (and keeps tests deterministic). Quality is
lower than the Claude judge; the UI shows which engine produced a suggestion.
"""

from __future__ import annotations

import re

from .. import text_ar as ar
from ..models import CLIP_TYPE_LABELS_AR
from .base import ClipJudgement


def _title_from(text: str, limit: int = 8) -> str:
    sentence = text.replace("؟", "؟.").split(".")[0].strip()
    words = sentence.split()
    t = " ".join(words[:limit])
    return t + ("…" if len(words) > limit else "")


class HeuristicLLM:
    name = "heuristic"

    def judge(self, items: list[dict]) -> list[ClipJudgement]:
        out: list[ClipJudgement] = []
        for it in items:
            text: str = it["text"]
            sentences = [s for s in re.split(r"(?<=[.!؟?])\s+", text) if s.strip()] or [text]
            first, last = sentences[0], sentences[-1]
            hook = ar.hook_strength(first)
            comp = 0.0 if ar.starts_dangling(text) else 0.55
            comp += 0.45 * ar.conclusion_strength(last)
            comp = min(1.0, comp)
            value = ar.value_strength(text)
            ctype = ar.classify_clip(text, it.get("duration", 30.0), hook, first)
            reason = self._reason(hook, comp, value, ctype)
            hooks = [{"type": "question" if ar.is_question(first) else "statement", "text": _title_from(first, 9)}]
            out.append(ClipJudgement(
                id=it["id"], hook=hook, completeness=comp, value=value,
                fresh_viewer_ok=not ar.starts_dangling(text),
                dangling_reference=ar.starts_dangling(text),
                clip_type=ctype, title=_title_from(first), reason_ar=reason, hooks=hooks,
                emphasis=ar.emphasis_words(text),
            ))
        return out

    @staticmethod
    def _reason(hook: float, comp: float, value: float, ctype: str) -> str:
        parts = []
        if hook >= 0.6:
            parts.append("افتتاحية جاذبة")
        if comp >= 0.8:
            parts.append("فكرة مكتملة بنهاية واضحة")
        if value >= 0.6:
            parts.append("قيمة معلوماتية واضحة")
        parts.append(f"النوع: {CLIP_TYPE_LABELS_AR.get(ctype, ctype)}")
        return "، ".join(parts)

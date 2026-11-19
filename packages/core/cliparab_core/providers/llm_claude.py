"""Claude judge (Anthropic Messages API, plain HTTPS: no SDK dependency).

The model only sees the candidate *text* (this doubles as the "fresh viewer test": it
cannot lean on the surrounding video). It returns strict JSON, validated here. Any
failure for a batch degrades to the heuristic judge for that batch, never to a crash.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request

from ..models import CLIP_TYPES
from .base import ClipJudgement
from .heuristic import HeuristicLLM

log = logging.getLogger(__name__)

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

SYSTEM_PROMPT = """أنت محرّر فيديو عربي خبير في صناعة مقاطع TikTok وReels وShorts.
ستصلك مقاطع مقترحة من فيديو طويل، كل مقطع نصّه فقط. قيّم كل مقطع كأنك مشاهد جديد لم يرَ بقية الفيديو.
أعد JSON صالحًا فقط (بدون أي شرح أو علامات markdown) بالشكل:
{"results":[{"id":<int>,"hook":<0-1>,"completeness":<0-1>,"value":<0-1>,
"fresh_viewer_ok":<bool>,"dangling_reference":<bool>,"type":"<viral|educational|opinion|story|comedy|quote|short|marketing>",
"title":"<عنوان عربي ≤ 60 حرفًا>","reason_ar":"<جملة واحدة لماذا يصلح>","hooks":[{"type":"<question|shock|number|story>","text":"<نص افتتاحية بديلة>"}],
"emphasis":["<كلمات للتأكيد ≤ 4>"],"start_shift":<int>,"end_shift":<int>}]}
القواعد:
- hook: قوة أول ثلاث ثوانٍ في جذب الانتباه.
- completeness: هل الفكرة مكتملة ولها بداية ونهاية مفهومتان؟
- value: هل يخرج المشاهد بمعلومة أو شعور أو ضحكة؟
- dangling_reference=true إذا بدأ المقطع بضمير أو إشارة (هذا/هو/ده/كده...) لا مرجع لها داخل المقطع.
- fresh_viewer_ok=false إذا لم يُفهم المقطع وحده.
- لا تخترع محتوى غير موجود في النص. لا تعتمد على ارتفاع الصوت أو الحماس وحدهما.
- حافظ على اللهجة كما هي في العناوين والافتتاحيات."""


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no JSON object in response")
    return json.loads(text[start: end + 1])


def _clamp01(v) -> float:
    try:
        return max(0.0, min(1.0, float(v)))
    except (TypeError, ValueError):
        return 0.0


class ClaudeLLM:
    name = "claude"

    def __init__(self, api_key: str | None = None, model: str | None = None, batch_size: int = 8,
                 timeout: float = 90.0, max_retries: int = 3):
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        self.model = model or os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
        self.batch_size = batch_size
        self.timeout = timeout
        self.max_retries = max_retries
        self._fallback = HeuristicLLM()
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")

    # ------------------------------------------------------------------ transport
    def _post(self, payload: dict) -> dict:
        data = json.dumps(payload).encode()
        headers = {"content-type": "application/json", "x-api-key": self.api_key, "anthropic-version": API_VERSION}
        last: Exception | None = None
        for attempt in range(self.max_retries):
            req = urllib.request.Request(API_URL, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                last = e
                if e.code in (429, 500, 502, 503, 529):
                    retry_after = float(e.headers.get("retry-after") or 2 ** attempt)
                    time.sleep(min(retry_after, 20))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError) as e:
                last = e
                time.sleep(2 ** attempt)
        raise RuntimeError(f"Claude API unreachable: {last}")

    def _call(self, items: list[dict]) -> list[dict]:
        user = json.dumps(
            [{"id": i["id"], "duration_sec": round(i.get("duration", 0), 1), "text": i["text"]} for i in items],
            ensure_ascii=False)
        resp = self._post({"model": self.model, "max_tokens": 4096, "temperature": 0.2,
                           "system": SYSTEM_PROMPT,
                           "messages": [{"role": "user", "content": user}]})
        text = "".join(b.get("text", "") for b in resp.get("content", []) if b.get("type") == "text")
        return _extract_json(text)["results"]

    # ------------------------------------------------------------------ API
    def judge(self, items: list[dict]) -> list[ClipJudgement]:
        out: dict[int, ClipJudgement] = {}
        for k in range(0, len(items), self.batch_size):
            batch = items[k: k + self.batch_size]
            try:
                for r in self._call(batch):
                    j = self._to_judgement(r)
                    out[j.id] = j
            except Exception as e:  # noqa: BLE001 - degrade, never crash the pipeline
                log.warning("Claude batch failed (%s); using heuristic fallback for %d items", e, len(batch))
            missing = [i for i in batch if i["id"] not in out]
            if missing:
                for j in self._fallback.judge(missing):
                    out[j.id] = j
        return [out[i["id"]] for i in items]

    @staticmethod
    def _to_judgement(r: dict) -> ClipJudgement:
        ctype = r.get("type", "educational")
        return ClipJudgement(
            id=int(r["id"]), hook=_clamp01(r.get("hook")), completeness=_clamp01(r.get("completeness")),
            value=_clamp01(r.get("value")), fresh_viewer_ok=bool(r.get("fresh_viewer_ok", True)),
            dangling_reference=bool(r.get("dangling_reference", False)),
            clip_type=ctype if ctype in CLIP_TYPES else "educational",
            title=str(r.get("title", ""))[:80], reason_ar=str(r.get("reason_ar", ""))[:240],
            hooks=[{"type": str(h.get("type", "statement")), "text": str(h.get("text", ""))[:120]}
                   for h in (r.get("hooks") or [])[:3] if isinstance(h, dict)],
            emphasis=[str(e) for e in (r.get("emphasis") or [])[:4]],
            suggested_start_shift=int(r.get("start_shift", 0) or 0), suggested_end_shift=int(r.get("end_shift", 0) or 0),
        )

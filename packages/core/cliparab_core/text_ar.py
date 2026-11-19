"""Arabic text heuristics.

These rules are deliberately transparent and dialect-tolerant. They provide the
no-LLM fallback and they back up LLM judgements (a clip that the model likes but
that starts with a dangling pronoun is still repaired or rejected).
"""

from __future__ import annotations

import re

from .models import Sentence, Word

_TASHKEEL = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_PUNCT_EDGE = re.compile(r"^[\s\"'«»()\[\]{}،,؛;:.!؟?…\-–—]+|[\s\"'«»()\[\]{}،,؛;:.!؟?…\-–—]+$")
_END_PUNCT = ("." , "!", "؟", "?", "…", "؛")
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize(text: str) -> str:
    """Normalise for *matching only* (never for display)."""
    t = _TASHKEEL.sub("", text)
    t = t.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي").replace("ة", "ه")
    return t.translate(_ARABIC_DIGITS)


def strip_edges(word: str) -> str:
    return _PUNCT_EDGE.sub("", word)


def norm_tokens(text: str) -> list[str]:
    return [normalize(strip_edges(w)) for w in text.split() if strip_edges(w)]


# --------------------------------------------------------------------------- word lists
_DANGLING_START = {
    # pronouns / demonstratives (MSA + common dialects)
    "هذا", "هذه", "هاذا", "هاذي", "ذلك", "تلك", "هو", "هي", "هم", "هن", "هما", "هؤلاء", "اولئك",
    "ده", "دي", "دول", "هاد", "هاي", "هادي", "هيك", "كده", "كدا", "هادا", "هذي",
    # connectives that only make sense after earlier context
    "لكن", "لذلك", "لذا", "اذن", "يعني", "ثم", "بعدين", "بعدها", "لان", "كذلك", "ايضا", "اما",
    "وبالتالي", "وبعدين", "وبعدها", "ولذلك", "وايضا", "وكذلك", "فبالتالي", "طيب", "اها", "ايوه", "ايوا", "بالضبط",
    # conclusions make poor openings: they only land after the argument
    "النتيجه", "الخلاصه", "باختصار",
}
# Spoken sentences that open with an attached "و" almost always continue the previous thought. Words whose
# root letter is و are excluded so "وقت" / "واضح" / "واحد" are not mistaken for conjunctions.
_WAW_ROOTS = ("وقت", "وجه", "واحد", "واضح", "وصف", "وزن", "وطن", "ورق", "وسط", "وضع", "وصل", "وعد", "وظيف", "وحد", "وراء",
              "وزار", "وسائل", "وسيل", "وثيق", "وعي", "ولد", "ولاد", "وقف", "وفاه", "والد", "والي", "وهم", "وحش", "وجود",
              "وجد", "وقع", "وفر", "وصي", "ورد", "وعاء", "ورش", "وكال", "وكيل", "وسام", "وجبه", "وجبات", "ولاي", "وليد")
_DANGLING_PREFIX_BASE = {"هذا", "هذه", "هو", "هي", "هم", "ذلك", "تلك", "هاد", "هاي", "ده", "دي", "لكن", "لان"}

_INCOMPLETE_END = {
    "و", "ف", "ثم", "لكن", "لان", "ان", "اللي", "الذي", "التي", "الذين", "يعني", "مثل", "حتي", "او", "في", "علي",
    "من", "الي", "عن", "مع", "لما", "اذا", "كي", "لكي", "ب", "ل", "ك", "ما", "لا", "هل", "بس", "كان", "كانت",
}

_QUESTION_WORDS = {
    "ماذا", "لماذا", "كيف", "هل", "متي", "اين", "من", "ما", "ماهي", "ماهو", "كم", "ليش", "ليه", "شلون", "وش", "ايش",
    "شو", "ازاي", "امتي", "فين", "كيفاش", "علاش", "اش", "قداش", "شنو", "اشمن", "علاه",
}

_POWER_WORDS = (
    "سر", "اسرار", "اخطر", "اكبر خطا", "لا تفعل", "لن تصدق", "الحقيقه", "ممنوع", "احذر", "كارثه", "مجانا", "افضل",
    "اسوا", "خطا", "خطاء", "الخطا", "ما يعرفه", "لا احد", "محد", "ابدا", "اهم", "غلطه", "صدمه", "مفاجاه",
)
_CURIOSITY = ("الكل يظن", "معظم الناس", "اغلب الناس", "ما يقوله", "ما تعرفه", "لو", "تخيل", "انتبه", "الفرق بين", "ليه", "لماذا")
_FILLER_START = {"امم", "اممم", "اه", "ااه", "ايه", "اها", "طيب", "خلاص", "يعني", "بس"}

_VALUE_MARKERS = (
    "لازم", "يجب", "نصيحه", "خطوه", "الطريقه", "القاعده", "مثال", "لان", "النتيجه", "تقدر", "ينفع", "الحل", "سبب",
    "اولا", "ثانيا", "ثالثا", "الاول", "الثاني", "افضل طريقه", "تجنب", "ابدا", "ركز", "استخدم",
)
_CONCLUSION_MARKERS = ("الخلاصه", "النتيجه", "باختصار", "المهم", "لهذا", "لذلك", "ولهذا", "وبالتالي", "ببساطه", "الخلاصه", "في النهايه")
_STORY_MARKERS = ("قصه", "في يوم", "حصل لي", "حدثت", "تذكر", "كنت", "ذات مره", "مره", "عندما كنت", "اتذكر", "وقتها")
_OPINION_MARKERS = ("رايي", "برايي", "اعتقد", "انا اشوف", "ما اتفق", "اختلف", "لا اتفق", "وجهه نظري", "غلط", "مبالغ", "ارى", "انا ارى")
_COMEDY_MARKERS = ("ههه", "هههه", "نكته", "اضحك", "ضحك", "مضحك", "تخيل", "😂")
_QUOTE_MARKERS = ("قال", "مقوله", "اقتباس", "كما قيل", "يقولون", "حكمه")
_MARKETING_MARKERS = ("عرض", "خصم", "منتج", "اشترك", "جرب", "تواصل معنا", "الرابط", "خدمه", "احجز", "اطلب", "تسجيل", "مجانا")

_STOPWORDS = {
    "في", "من", "علي", "الي", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي", "كان", "كانت", "ليس", "لكن", "ثم", "او",
    "ان", "انه", "انها", "كل", "قد", "هو", "هي", "ما", "لا", "نعم", "يعني", "اللي", "عند", "بعد", "قبل", "حتي", "اذا",
    "كيف", "لماذا", "ماذا", "الان", "جدا", "بس", "وهو", "وهي", "انا", "انت", "نحن", "هم", "هل", "اي", "كده", "ده", "دي",
}


def _contains_any(norm_text: str, markers: tuple[str, ...]) -> int:
    return sum(1 for m in markers if m in norm_text)


# --------------------------------------------------------------------------- sentences
def _ends_sentence(word: str) -> bool:
    w = word.rstrip("\"'») ")
    return w.endswith(_END_PUNCT)


def split_sentences(words: list[Word], gap: float = 0.8, min_words: int = 4, max_words: int = 45) -> list[Sentence]:
    """Group a flat word list into sentences.

    A sentence ends at terminal punctuation, at a speaker change, or at a pause longer
    than ``gap`` seconds. Very short sentences are merged forward (unless they end in a
    question mark, which are usually complete hooks); very long ones are split at their
    longest internal pause.
    """
    groups: list[list[Word]] = []
    cur: list[Word] = []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        boundary = nxt is None
        if nxt is not None:
            if _ends_sentence(w.text) or (nxt.start - w.end) > gap or (w.speaker != nxt.speaker):
                boundary = True
        if boundary:
            groups.append(cur)
            cur = []

    merged: list[list[Word]] = []
    for g in groups:
        if merged and len(merged[-1]) < min_words and not merged[-1][-1].text.rstrip().endswith(("؟", "?")) \
                and merged[-1][-1].speaker == g[0].speaker:
            merged[-1].extend(g)
        else:
            merged.append(g)
    if len(merged) > 1 and len(merged[-1]) < min_words and merged[-2][-1].speaker == merged[-1][0].speaker:
        merged[-2].extend(merged.pop())

    final: list[list[Word]] = []
    for g in merged:
        while len(g) > max_words:
            lo, hi = 8, len(g) - 8
            if hi <= lo:
                break
            k = max(range(lo, hi), key=lambda j: g[j + 1].start - g[j].end if j + 1 < len(g) else 0)
            final.append(g[: k + 1])
            g = g[k + 1:]
        final.append(g)

    sentences: list[Sentence] = []
    for g in final:
        sentences.append(Sentence(id=len(sentences), start=g[0].start, end=g[-1].end,
                                  text=" ".join(w.text for w in g), words=g, speaker=g[0].speaker))
    return sentences


# --------------------------------------------------------------------------- boundary checks
def starts_dangling(text: str) -> bool:
    toks = norm_tokens(text)
    if not toks:
        return True
    first = toks[0]
    if first in _DANGLING_START:
        return True
    if first.startswith(("و", "ف")) and first[1:] in _DANGLING_PREFIX_BASE:
        return True
    if first.startswith("و") and len(first) >= 4 and not first.startswith(_WAW_ROOTS):
        return True
    if first in _FILLER_START and len(toks) <= 3:
        return True
    return False


def ends_incomplete(text: str) -> bool:
    stripped = text.rstrip()
    if stripped.endswith(("،", ",", ":", "-", "...")):
        return True
    toks = norm_tokens(text)
    if not toks:
        return True
    return toks[-1] in _INCOMPLETE_END


_TRANSITIONS = ("ننتقل", "موضوع ثاني", "موضوع اخر", "نكمل", "الحلقه القادمه", "الفيديو القادم", "اشتركوا", "اشترك في القناه",
                "لا تنسوا", "شكرا لكم", "شكرا لمتابعتكم", "الي اللقاء", "الى اللقاء", "ضغطه لايك", "لايك واشتراك", "السلام عليكم")


def is_transition(text: str) -> bool:
    """Housekeeping phrases ("let's move on", "thanks for watching") that never belong in a clip."""
    n = normalize(text)
    return any(normalize(t) in n for t in _TRANSITIONS)


def is_question(text: str) -> bool:
    if "؟" in text or "?" in text:
        return True
    toks = norm_tokens(text)
    return bool(toks) and toks[0] in _QUESTION_WORDS


# --------------------------------------------------------------------------- feature scores (0..1)
def hook_strength(first_text: str, following: str = "") -> float:
    """How attention-grabbing is the opening? (0..1)"""
    n = normalize(first_text)
    toks = n.split()
    score = 0.15
    if is_question(first_text):
        score += 0.30
    if re.search(r"\d", n) or any(t in ("واحد", "اثنين", "ثلاثه", "اربعه", "خمسه", "عشره", "ثلاث", "خمس", "سبع", "مليون", "الف") for t in toks[:12]):
        score += 0.15
    if _contains_any(n, _POWER_WORDS):
        score += 0.25
    if _contains_any(n, _CURIOSITY):
        score += 0.15
    if 3 <= len(toks) <= 14:
        score += 0.10
    if toks and toks[0] in _FILLER_START:
        score -= 0.20
    if len(toks) > 28:
        score -= 0.10
    return max(0.0, min(1.0, score))


def value_strength(text: str) -> float:
    n = normalize(text)
    hits = _contains_any(n, _VALUE_MARKERS) + _contains_any(n, _CONCLUSION_MARKERS) + _contains_any(n, _STORY_MARKERS) \
        + _contains_any(n, _OPINION_MARKERS)
    digits = len(re.findall(r"\d+", n))
    words = max(len(n.split()), 1)
    density = min(1.0, (hits + 0.5 * digits) / max(3.0, words / 12))
    return max(0.15, min(1.0, 0.25 + 0.6 * density))


def conclusion_strength(last_text: str) -> float:
    n = normalize(last_text)
    s = 0.35
    if _contains_any(n, _CONCLUSION_MARKERS):
        s += 0.35
    if last_text.rstrip().endswith((".", "!", "؟", "?")):
        s += 0.2
    if len(n.split()) >= 6:
        s += 0.1
    if ends_incomplete(last_text):
        s -= 0.45
    return max(0.0, min(1.0, s))


def classify_clip(text: str, duration: float, hook: float, first_text: str = "") -> str:
    n = normalize(text)
    if duration <= 20:
        base = "short"
    else:
        base = "educational"
    if _contains_any(n, _COMEDY_MARKERS) >= 1:
        return "comedy"
    if _contains_any(n, _MARKETING_MARKERS) >= 2:
        return "marketing"
    if _contains_any(n, _STORY_MARKERS) >= 2:
        return "story"
    if _contains_any(n, _OPINION_MARKERS) >= 1:
        return "opinion"
    if _contains_any(n, _QUOTE_MARKERS) >= 1 and duration <= 30:
        return "quote"
    if _contains_any(n, _VALUE_MARKERS) >= 2:
        return "educational"
    if hook >= 0.7:
        return "viral"
    return base


def emphasis_words(text: str, n: int = 4) -> list[str]:
    """Pick likely emphasis words: numbers first, then the longest content words."""
    seen: dict[str, None] = {}
    toks = [strip_edges(w) for w in text.split()]
    for t in toks:
        if re.search(r"\d", normalize(t)):
            seen.setdefault(t, None)
    content = [t for t in toks if t and normalize(t) not in _STOPWORDS and len(normalize(t)) >= 5 and not re.search(r"\d", normalize(t))]
    content.sort(key=lambda t: -len(normalize(t)))
    for t in content:
        if len(seen) >= n:
            break
        seen.setdefault(t, None)
    return list(seen)[:n]


# --------------------------------------------------------------------------- captions
def chunk_words_for_captions(words: list[Word], max_chars: int = 24, max_lines: int = 2) -> list[list[Word]]:
    """Split words into caption events of <= ``max_lines`` lines of <= ``max_chars``.

    Splits prefer sentence punctuation and pauses, never produce a one-word orphan
    unless the sentence is one word, and keep events short enough to read comfortably.
    """
    events: list[list[Word]] = []
    cur: list[Word] = []
    cur_chars = 0
    limit = max_chars * max_lines
    for i, w in enumerate(words):
        add = len(w.text) + (1 if cur else 0)
        if cur and cur_chars + add > limit:
            events.append(cur)
            cur, cur_chars = [], 0
            add = len(w.text)
        cur.append(w)
        cur_chars += add
        nxt = words[i + 1] if i + 1 < len(words) else None
        hard_stop = w.text.rstrip().endswith(("،", ",", ".", "؟", "?", "!", "؛", "…"))
        pause = nxt is not None and (nxt.start - w.end) > 0.55
        if (hard_stop or pause) and cur_chars >= max_chars * 0.6:
            events.append(cur)
            cur, cur_chars = [], 0
    if cur:
        if events and len(cur) == 1 and len(events[-1]) + 1 <= 7:
            events[-1].extend(cur)
        else:
            events.append(cur)
    return events


def split_two_lines(words: list[Word], max_chars: int = 24) -> list[list[Word]]:
    """Break one event into <= 2 balanced lines."""
    total = sum(len(w.text) for w in words) + max(len(words) - 1, 0)
    if total <= max_chars or len(words) < 3:
        return [words]
    best_k, best_diff = 1, 10 ** 9
    run = 0
    for k in range(1, len(words)):
        run += len(words[k - 1].text) + 1
        diff = abs(run - (total - run))
        if diff < best_diff:
            best_k, best_diff = k, diff
    return [words[:best_k], words[best_k:]]

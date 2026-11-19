import sample
from cliparab_core import text_ar as ar
from cliparab_core.subtitles import fmt_srt_ts, parse_subtitles, to_srt


def test_srt_roundtrip_and_interpolation():
    tr = parse_subtitles(sample.make_srt())
    assert len(tr.segments) == len(sample.SENTENCES)
    assert tr.engine == "subtitle-import" and tr.language == "ar"
    seg = tr.segments[0]
    assert seg.words[0].start >= seg.start and seg.words[-1].end <= seg.end + 1e-6
    assert all(w.approx for w in seg.words)
    assert fmt_srt_ts(3661.5) == "01:01:01,500"
    again = parse_subtitles(to_srt([(s.start, s.end, s.text) for s in tr.segments]))
    assert [s.text for s in again.segments] == [s.text for s in tr.segments]


def test_vtt_and_bom_and_tags():
    raw = "﻿WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n<i>مرحبا بكم</i>\nفي القناة\n"
    tr = parse_subtitles(raw)
    assert tr.segments[0].text == "مرحبا بكم في القناة"
    assert abs(tr.segments[0].end - 3.5) < 1e-9


def test_dangling_starts():
    for t in ["هذا هو السر الحقيقي", "هو قال لي", "ده مش صح", "لكن المشكلة أكبر", "وهذا يعني", "يعني كده"]:
        assert ar.starts_dangling(t), t
    for t in ["السبب الحقيقي أنهم يبدؤون", "هل تعرف لماذا يفشل الناس؟", "ثلاث عادات تغير حياتك"]:
        assert not ar.starts_dangling(t), t


def test_incomplete_endings_and_questions():
    assert ar.ends_incomplete("وبعد ذلك قال لي،")
    assert ar.ends_incomplete("هذا هو الحل الذي")
    assert not ar.ends_incomplete("الاستمرار أهم من الحجم دائما.")
    assert ar.is_question("هل تعرف السبب") and ar.is_question("كيف تبدأ") and not ar.is_question("هذا خبر")


def test_normalize_handles_tashkeel_and_digits():
    assert ar.normalize("مُحَمَّد") == "محمد"
    assert ar.normalize("أَكْبَر") == ar.normalize("اكبر")
    assert ar.normalize("٣٠ يوما") == "30 يوما"


def test_hook_prefers_questions_and_power_words():
    assert ar.hook_strength("هل تعرف لماذا يفشل أغلب الناس؟") > ar.hook_strength("امم يعني بس خلاص")
    assert ar.hook_strength("أخطر خطأ يرتكبه 90 بالمئة من الناس") > 0.5


def test_split_sentences_by_punctuation_pause_and_speaker():
    tr = parse_subtitles(sample.make_srt())
    sents = ar.split_sentences(tr.words())
    assert 20 <= len(sents) <= len(sample.SENTENCES) + 2
    assert all(s.end > s.start for s in sents)
    assert all(sents[i].end <= sents[i + 1].start + 1e-6 for i in range(len(sents) - 1))


def test_caption_chunks_respect_limits():
    tr = parse_subtitles(sample.make_srt())
    words = tr.segments[10].words
    events = ar.chunk_words_for_captions(words, max_chars=22)
    assert sum(len(e) for e in events) == len(words)
    for e in events:
        lines = ar.split_two_lines(e, 22)
        assert len(lines) <= 2
        assert sum(len(l) for l in lines) == len(e)


def test_attached_waw_is_a_continuation_unless_root_letter():
    assert ar.starts_dangling("والمفاجأة أن الناس لا يلاحظون")
    assert ar.starts_dangling("وبعد ثلاثة أيام يتوقف")
    assert not ar.starts_dangling("وقت التنفيذ هو أهم عنصر")
    assert not ar.starts_dangling("واضح أن الخطة ناجحة")
    assert ar.starts_dangling("النتيجة أن التوفير عادة")

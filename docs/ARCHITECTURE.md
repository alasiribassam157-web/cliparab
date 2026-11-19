# المعمارية

```
المتصفح (Next.js) ──HTTP /v1──▶ API (Starlette) ──┐
                                   │ SQLite/Postgres │
                                   ▼                 │ جدول jobs (مطالبة ذرّية)
                               ملفات /data ◀── عامل (cliparab-worker) ── FFmpeg · Whisper · Claude
```

## خط المعالجة (8 مراحل في الوثيقة ← الكود)
| المرحلة | الكود |
|---|---|
| 1 رفع/استيراد | `apps/api/app/routes.py::upload_source` (فحص ffprobe، حدود الحجم/المدة) |
| 2 تجهيز (ffprobe، صوت 16k، proxy 360p) | `cliparab_core.media`, `worker.handle_analyze` |
| 3 تفريغ + لهجة | `providers/asr_local.py` (faster-whisper) · `asr_openai.py` · `subtitles.py` (استيراد SRT/VTT) |
| 4 فصول/موضوعات | `topics.py` (TextTiling معجمي بتجذير خفيف؛ قابل للاستبدال بتضمينات) |
| 5 تحليل دلالي | `providers/llm_claude.py` (JSON صارم، يرى نص المقطع فقط = «اختبار المشاهد الجديد») + `text_ar.py` |
| 6 ClipScore | `scoring.py` |
| 7 تحرير/تأطير/ترجمة | `reframe.py`, `captions.py`, `media.track_subject` |
| 8 تصدير | `render.py` (H.264/AAC، loudnorm -14 LUFS، ASS عبر libass) |

كل مرحلة تحفظ ناتجها في مجلد المشروع (`transcript.json`, `suggestions.json`, …) وتُتخطى إن وُجد (idempotent)، لذا إعادة تشغيل مهمة فاشلة آمنة.

## قرارات
- **حدود الجمل + إصلاح الحدود** بدل القص بطول ثابت.
- **المزج بين LLM والقواعد**: حكم Claude يُمزج (65%) مع قواعد شفافة، والمرفوضات الموضوعية (بداية معلّقة، نهاية مبتورة، كلام قليل) لا يتجاوزها أي تقييم.
- **التدهور الآمن**: فشل Claude لأي دفعة ⇒ حكم محلي لتلك الدفعة، لا فشل المهمة.
- **الرصيد (ledger)**: حجز عند البدء واسترداد تلقائي عند الفشل/الإلغاء.
- **طابور في قاعدة البيانات** بدل Redis للـ MVP: أبسط، قابل للاختبار، وجاهز لـ `FOR UPDATE SKIP LOCKED` في Postgres.
- **API بـ Starlette + Pydantic** (طبقات FastAPI نفسها) لأن FastAPI لم يكن قابلًا للتثبيت في بيئة البناء؛ الانتقال إليه ميكانيكي.

# واجهة API (`/v1`)

**لا حسابات ولا خطط ولا حدود دقائق.** كل متصفح يولّد مفتاحًا عشوائيًا (≥32 حرفًا من `A-Za-z0-9_-`) ويرسله في `Authorization: Bearer <مفتاح>` (أو `?access_token=<مفتاح>` لوسوم `<video>` وSSE). يُنشأ المستخدم تلقائيًا عند أول طلب، ولا يخزّن الخادم إلا بصمة المفتاح؛ مشاريع كل مفتاح معزولة عن غيره، وضياع المفتاح يعني ضياع الوصول لمشاريعه. كل الأخطاء بالشكل:
```json
{"error": {"code": "NOT_FOUND", "message_ar": "…", "message_en": "…", "details": {}, "request_id": "req_…"}}
```
الرموز: `UNAUTHENTICATED 401` · `VALIDATION_ERROR 422` · `NOT_FOUND 404` · `VERSION_CONFLICT 409` · `PRECONDITION_REQUIRED 428` · `RATE_LIMITED 429 (+Retry-After)` · `FILE_TOO_LARGE 413` · `UNSUPPORTED_MEDIA 415` · `TOO_LONG 422` · `ASR_UNAVAILABLE 503` · `NO_SPEECH 422` · `EXPIRED 410`.

| الطريقة | المسار | ملاحظات |
|---|---|---|
| GET/PATCH/DELETE | `/me` | `PATCH {locale, allow_training}` · `DELETE` يمسح كل مشاريع هذا المفتاح وملفاته نهائيًا (بلا كلمة مرور) |
| GET/POST | `/projects` | |
| GET/DELETE | `/projects/{id}` | يحتوي `active_job_id` |
| POST | `/projects/{id}/source?filename=` | جسم الطلب = الملف الخام (بث) |
| POST | `/projects/{id}/source-url` | `{url}` ← `202` + job من نوع `import`؛ ينزّل الفيديو من رابط عام (يوتيوب وغيره عبر yt-dlp) ويثبّته كمصدر. روابط https عامة فقط (يُرفض localhost والعناوين الخاصة)، `503 DOWNLOAD_UNAVAILABLE` إن لم يكن yt-dlp مثبّتًا، `422 DOWNLOAD_FAILED` إن فشل التنزيل. التنزيل مجاني؛ الدقائق تُحجز عند `analyze` |
| PUT | `/projects/{id}/subtitles` | نص SRT/VTT؛ يتجاوز التفريغ |
| POST | `/projects/{id}/analyze` | `202` + job · يدعم `Idempotency-Key` |
| GET | `/jobs/{id}` · `/jobs/{id}/events` (SSE) · `DELETE /jobs/{id}` يلغي المنتظِر ويستردّ |
| GET | `/projects/{id}/suggestions` · `/transcript` · `/media` | |
| POST/GET | `/projects/{id}/clips` | من `suggestion_id` أو `start`+`end` |
| GET/PATCH/DELETE | `/clips/{id}` | `PATCH` يتطلب `If-Match: <version>`؛ يعيد `ETag` |
| POST | `/clips/{id}/exports` | `{resolution: "720p"|"1080p"}` ← job |
| GET | `/exports/{id}` · `/exports/{id}/file[?download=1]` | يدعم Range |
| POST | `/clips/{id}/review-links` | رابط عام للتعليق فقط |
| GET/POST | `/review/{token}` · `/file` · `/comments` | بلا مصادقة |

`edit_state`: `{start,end,layout: fill|fit|split, reframe_mode: auto|center|manual, manual_center, split_centers, captions, caption:{mode: karaoke|plain|pop, position, font_size, color, highlight, emphasis[], box}, words?, resolution, loudnorm, denoise}`.

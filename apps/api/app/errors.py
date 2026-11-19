"""Unified error shape: {"error": {"code", "message_ar", "message_en", "details", "request_id"}}."""

from __future__ import annotations

from typing import Any

MESSAGES: dict[str, tuple[int, str, str]] = {
    "UNAUTHENTICATED": (401, "مفتاح الجلسة مفقود أو غير صالح.", "Missing or invalid session key."),
    "FORBIDDEN": (403, "لا تملك صلاحية لهذا الإجراء.", "You do not have access to this resource."),
    "NOT_FOUND": (404, "العنصر المطلوب غير موجود.", "Resource not found."),
    "VALIDATION_ERROR": (422, "البيانات المدخلة غير صالحة.", "Invalid request data."),
    "VERSION_CONFLICT": (409, "تم تعديل هذا المقطع من مكان آخر. أعد التحميل ثم حاول مجددًا.", "The clip was modified elsewhere."),
    "PRECONDITION_REQUIRED": (428, "أرسل رقم النسخة في ترويسة If-Match.", "If-Match header with the clip version is required."),
    "RATE_LIMITED": (429, "طلبات كثيرة، حاول بعد قليل.", "Too many requests."),
    "FILE_TOO_LARGE": (413, "حجم الملف أكبر من الحد المسموح.", "File exceeds the upload limit."),
    "UNSUPPORTED_MEDIA": (415, "تعذّر قراءة هذا الملف. جرّب MP4 أو MOV أو MKV أو WEBM.", "Unsupported or unreadable media file."),
    "TOO_LONG": (422, "الفيديو أطول من الحد المسموح.", "Video exceeds the maximum length."),
    "NOT_READY": (409, "هذا العنصر غير جاهز بعد.", "Resource is not ready yet."),
    "URL_INVALID": (422, "الرابط غير صالح. استخدم رابط فيديو عامًا يبدأ بـ https.", "Invalid video link. Use a public https link."),
    "DOWNLOAD_UNAVAILABLE": (503, "الاستيراد من الروابط غير مفعّل على هذا الخادم. ارفع الملف مباشرة.", "Importing from links is not enabled on this server."),
    "DOWNLOAD_FAILED": (422, "تعذّر تنزيل الفيديو من هذا الرابط. تأكد أنه عام ويعمل، أو ارفع الملف مباشرة.", "Could not download the video from this link."),
    "NO_SOURCE": (409, "ارفع فيديو أولًا.", "Upload a source video first."),
    "ASR_UNAVAILABLE": (503, "خدمة التفريغ النصي غير مفعّلة. ارفع ملف ترجمة SRT أو فعّل Whisper.", "Speech recognition is not configured."),
    "NO_SPEECH": (422, "لم نجد كلامًا واضحًا في هذا الفيديو. جرّب فيديو بصوت أوضح أو ارفع ملف ترجمة.", "No clear speech was found in this video."),
    "EXPIRED": (410, "انتهت صلاحية هذا الرابط.", "This link has expired."),
    "INTERNAL": (500, "حدث خطأ غير متوقع. لم تُخصم أي دقائق.", "Unexpected error. No minutes were charged."),
}


class ApiError(Exception):
    def __init__(self, code: str, details: Any = None, headers: dict[str, str] | None = None,
                 message_ar: str | None = None, message_en: str | None = None):
        status, ar, en = MESSAGES[code]
        self.status, self.code, self.details, self.headers = status, code, details, headers or {}
        self.message_ar, self.message_en = message_ar or ar, message_en or en
        super().__init__(f"{code}: {self.message_en}")

    def body(self, request_id: str) -> dict:
        return {"error": {"code": self.code, "message_ar": self.message_ar, "message_en": self.message_en,
                          "details": self.details, "request_id": request_id}}

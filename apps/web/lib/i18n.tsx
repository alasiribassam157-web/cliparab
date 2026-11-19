"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "./types";

type Dict = Record<string, string>;

const ar: Dict = {
  app_name: "ClipArab",
  tagline: "من الحلقة الطويلة إلى مقاطع جاهزة للنشر — بالعربي",
  nav_projects: "مشاريعي", nav_settings: "الإعدادات", nav_new: "مشروع جديد", nav_logout: "خروج", nav_login: "دخول", nav_register: "حساب جديد",
  demo_banner: "وضع تجريبي: لا يوجد خادم متصل. البيانات في متصفحك، والمقاطع المعروضة صُيِّرت فعليًا بمحرّك ClipArab على حلقة نموذجية.",
  demo_try: "جرّب الآن بدون تسجيل",
  hero_title: "حوّل حلقتك الطويلة إلى مقاطع تُشاهَد حتى النهاية",
  hero_sub: "ClipArab يفهم المعنى بالعربية (فصحى ولهجات)، فيقصّ عند حدود الأفكار لا عند أرقام ثابتة: بداية مفهومة، نهاية مكتملة، وترجمة عربية سليمة الحروف والاتجاه.",
  f1_t: "يفهم السياق لا الصوت العالي", f1_d: "تقييم شفاف من 100 لكل مقطع، مع شرح عربي لسبب اقتراحه.",
  f2_t: "ترجمة عربية صحيحة", f2_d: "اتصال الحروف واتجاه RTL وإبراز الكلمات، داخل مناطق آمنة بعيدة عن أزرار المنصات.",
  f3_t: "مجاني بلا علامة مائية", f3_d: "الخطة المجانية تصدّر 1080p بدون أي علامة مائية.",
  f4_t: "خصوصيتك أولًا", f4_d: "لا نُدرّب نماذج على فيديوهاتك دون موافقتك. حذف نهائي بضغطة، وحذف تلقائي بعد المدة التي تختارها.",
  how_t: "كيف يعمل؟", s1: "ارفع الفيديو", s2: "نفرّغ الكلام ونفهم الأفكار", s3: "نقترح أفضل المقاطع", s4: "عدّل وصدّر لـ TikTok وReels وShorts",
  legal_note: "نستورد الفيديوهات التي ترفعها أنت فقط. لا نتجاوز أي حماية ولا ننشر نيابةً عنك بلا واجهة رسمية.",
  email: "البريد الإلكتروني", password: "كلمة المرور", name: "الاسم", login: "تسجيل الدخول", register: "إنشاء حساب",
  no_account: "ليس لديك حساب؟", have_account: "لديك حساب؟",
  projects_title: "مشاريعي", no_projects: "لا توجد مشاريع بعد. ابدأ بمشروعك الأول.", minutes_left: "دقيقة متبقية هذا الشهر",
  new_title: "مشروع جديد", project_name: "اسم المشروع", pick_video: "اختر فيديو أو اسحبه هنا", pick_srt: "ملف ترجمة SRT/VTT (اختياري، يتجاوز التفريغ)",
  demo_upload_note: "في الوضع التجريبي يُستخدم فيديو نموذجي بدل ملفك.", start_analysis: "ابدأ التحليل", uploading: "جارٍ الرفع…",
  status_empty: "فارغ", status_ready: "جاهز للتحليل", status_processing: "قيد المعالجة", status_done: "اكتمل", status_error: "خطأ",
  stage_probe: "قراءة الفيديو", stage_transcribe: "تفريغ الكلام", stage_segment: "فهم السياق", stage_score: "تقييم المقاطع", stage_preview: "تجهيز المعاينة", stage_done: "اكتمل",
  processing_title: "نحلّل الحلقة…", processing_hint: "يمكنك إغلاق الصفحة؛ نكمل في الخلفية.",
  suggestions: "المقاطع المقترحة", why_clip: "لماذا هذا المقطع؟", edit: "تحرير", preview_source: "معاينة", transcript: "النص",
  score: "التقييم", dur: "المدة", sec: "ث",
  k_hook: "قوة الافتتاحية", k_complete: "اكتمال الفكرة", k_value: "القيمة", k_audio: "جودة الصوت", k_visual: "الصورة", k_engage: "الإيقاع",
  p_ends_mid_thought: "ينتهي قبل اكتمال الفكرة", p_dangling_start: "يبدأ بإشارة بلا مرجع", p_needs_context: "لا يُفهم وحده", p_low_speech_ratio: "كلام قليل",
  p_low_asr_confidence: "ثقة التفريغ منخفضة", p_bad_duration: "مدة غير مناسبة", p_duration_fit: "مدة بعيدة عن 20–50 ث", p_crosses_topic: "يعبر موضوعين", p_transition_phrase: "عبارة ختام/انتقال",
  type_viral: "الأكثر انتشارًا", type_educational: "تعليمي", type_opinion: "رأي", type_story: "قصة", type_comedy: "كوميدي", type_quote: "اقتباس", type_short: "قصير جدًا", type_marketing: "تسويقي",
  engine_heuristic: "تحليل محلي (بدون Claude)", engine_claude: "Claude",
  ed_trim: "القص", ed_emph: "إبراز", ed_layout: "التخطيط", ed_captions: "الترجمة", ed_text: "النص", ed_export: "التصدير",
  start: "البداية", end: "النهاية", layout_fill: "ملء الإطار", layout_fit: "احتواء بخلفية", layout_split: "شاشة مقسومة",
  reframe: "تتبّع الموضوع", reframe_auto: "تلقائي", reframe_note: "المعاينة تقريبية؛ التتبّع التلقائي للموضوع يُطبَّق عند التصدير.", reframe_center: "المنتصف", reframe_manual: "يدوي", center_pos: "موضع الإطار",
  cap_on: "إظهار الترجمة", cap_mode: "النمط", cap_karaoke: "إبراز تدريجي", cap_plain: "عادي", cap_pop: "كلمة كلمة", cap_pos: "الموضع", pos_bottom: "أسفل", pos_middle: "وسط", pos_top: "أعلى",
  cap_size: "حجم الخط", cap_color: "اللون", emphasis_hint: "اضغط على كلمة لإبرازها أو إلغاء إبرازها",
  edit_words_hint: "عدّل الكلمات مباشرة؛ ينعكس ذلك على الترجمة المحروقة.", saved: "تم الحفظ", saving: "جارٍ الحفظ…", conflict: "عُدِّل هذا المقطع في مكان آخر. أعد التحميل.",
  resolution: "الدقة", export_btn: "تصدير المقطع", exporting: "جارٍ التصيير…", download: "تنزيل MP4", no_watermark: "بدون علامة مائية",
  demo_export_note: "في الوضع التجريبي يُنزَّل المقطع المُصيَّر مسبقًا بالمحرّك لهذه الاقتراحات.",
  review_link: "رابط مراجعة", copy: "نسخ", copied: "تم النسخ", review_title: "مراجعة المقطع", add_comment: "أضف تعليقًا", your_name: "اسمك", comment: "التعليق", send: "إرسال",
  no_video_yet: "لم يُصدَّر هذا المقطع بعد.", comments: "التعليقات",
  settings_title: "الإعدادات", privacy: "الخصوصية", train_consent: "السماح باستخدام فيديوهاتي لتحسين النماذج", train_hint: "متوقف افتراضيًا. لا يحدث أي تدريب دون موافقتك الصريحة.",
  retention: "مدة الاحتفاظ", days: "يومًا", danger: "منطقة الخطر", delete_project: "حذف المشروع نهائيًا", delete_account: "حذف الحساب وكل بياناتي", confirm_password: "أدخل كلمة المرور للتأكيد",
  confirm_delete: "سيُحذف كل شيء نهائيًا، ولا يمكن التراجع. متأكد؟", language: "اللغة", theme: "المظهر",
  error_generic: "حدث خطأ. حاول مرة أخرى.", back: "رجوع", loading: "جارٍ التحميل…", cancel: "إلغاء", delete: "حذف", close: "إغلاق", open: "فتح", plan: "الخطة", free: "مجانية",
};

const en: Dict = {
  app_name: "ClipArab",
  tagline: "From long episodes to ready-to-post clips — Arabic first",
  nav_projects: "Projects", nav_settings: "Settings", nav_new: "New project", nav_logout: "Log out", nav_login: "Log in", nav_register: "Sign up",
  demo_banner: "Demo mode: no server connected. Data stays in your browser; the clips shown were really rendered by the ClipArab engine from a sample episode.",
  demo_try: "Try it now, no sign-up",
  hero_title: "Turn your long episode into clips people watch to the end",
  hero_sub: "ClipArab understands Arabic meaning (MSA and dialects), cutting at the edges of ideas rather than fixed lengths: an understandable start, a complete ending, and correctly shaped RTL captions.",
  f1_t: "Understands context, not loudness", f1_d: "A transparent score out of 100 for every clip, with a plain-language reason.",
  f2_t: "Correct Arabic captions", f2_d: "Joined letters, RTL direction and word highlighting, inside safe zones clear of platform buttons.",
  f3_t: "Free, no watermark", f3_d: "The free plan exports 1080p with no watermark.",
  f4_t: "Privacy first", f4_d: "We never train on your videos without consent. One-click permanent deletion and automatic expiry.",
  how_t: "How it works", s1: "Upload a video", s2: "We transcribe and understand the ideas", s3: "We suggest the best clips", s4: "Edit and export for TikTok, Reels and Shorts",
  legal_note: "We only import videos you upload yourself. We never bypass protections or post for you without an official API.",
  email: "Email", password: "Password", name: "Name", login: "Log in", register: "Create account",
  no_account: "No account yet?", have_account: "Already have an account?",
  projects_title: "My projects", no_projects: "No projects yet. Start with your first one.", minutes_left: "minutes left this month",
  new_title: "New project", project_name: "Project name", pick_video: "Choose a video or drop it here", pick_srt: "SRT/VTT subtitles (optional, skips transcription)",
  demo_upload_note: "In demo mode a sample video is used instead of your file.", start_analysis: "Start analysis", uploading: "Uploading…",
  status_empty: "Empty", status_ready: "Ready to analyze", status_processing: "Processing", status_done: "Done", status_error: "Error",
  stage_probe: "Reading video", stage_transcribe: "Transcribing", stage_segment: "Understanding context", stage_score: "Scoring clips", stage_preview: "Preparing preview", stage_done: "Done",
  processing_title: "Analyzing your episode…", processing_hint: "You can close this page; we keep working in the background.",
  suggestions: "Suggested clips", why_clip: "Why this clip?", edit: "Edit", preview_source: "Preview", transcript: "Transcript",
  score: "Score", dur: "Length", sec: "s",
  k_hook: "Hook strength", k_complete: "Idea completeness", k_value: "Value", k_audio: "Audio quality", k_visual: "Visual", k_engage: "Pacing",
  p_ends_mid_thought: "Ends before the idea is finished", p_dangling_start: "Opens with an unresolved reference", p_needs_context: "Not understandable on its own", p_low_speech_ratio: "Little speech",
  p_low_asr_confidence: "Low transcription confidence", p_bad_duration: "Unsuitable length", p_duration_fit: "Far from 20–50 s", p_crosses_topic: "Crosses two topics", p_transition_phrase: "Outro / transition phrase",
  type_viral: "Most shareable", type_educational: "Educational", type_opinion: "Opinion", type_story: "Story", type_comedy: "Comedy", type_quote: "Quote", type_short: "Very short", type_marketing: "Marketing",
  engine_heuristic: "Local analysis (no Claude)", engine_claude: "Claude",
  ed_trim: "Trim", ed_emph: "Emphasis", ed_layout: "Layout", ed_captions: "Captions", ed_text: "Text", ed_export: "Export",
  start: "Start", end: "End", layout_fill: "Fill frame", layout_fit: "Fit with blur", layout_split: "Split screen",
  reframe: "Subject tracking", reframe_auto: "Auto", reframe_note: "Preview is approximate; automatic subject tracking is applied at export.", reframe_center: "Center", reframe_manual: "Manual", center_pos: "Frame position",
  cap_on: "Show captions", cap_mode: "Style", cap_karaoke: "Word highlight", cap_plain: "Plain", cap_pop: "Word by word", cap_pos: "Position", pos_bottom: "Bottom", pos_middle: "Middle", pos_top: "Top",
  cap_size: "Font size", cap_color: "Color", emphasis_hint: "Click a word to emphasize or un-emphasize it",
  edit_words_hint: "Edit words directly; changes are burned into the captions.", saved: "Saved", saving: "Saving…", conflict: "This clip was changed elsewhere. Reload.",
  resolution: "Resolution", export_btn: "Export clip", exporting: "Rendering…", download: "Download MP4", no_watermark: "No watermark",
  demo_export_note: "In demo mode the pre-rendered clip for these suggestions is downloaded.",
  review_link: "Review link", copy: "Copy", copied: "Copied", review_title: "Clip review", add_comment: "Add a comment", your_name: "Your name", comment: "Comment", send: "Send",
  no_video_yet: "This clip has not been exported yet.", comments: "Comments",
  settings_title: "Settings", privacy: "Privacy", train_consent: "Allow my videos to improve models", train_hint: "Off by default. Nothing is used for training without your explicit consent.",
  retention: "Retention", days: "days", danger: "Danger zone", delete_project: "Delete project permanently", delete_account: "Delete account and all my data", confirm_password: "Enter your password to confirm",
  confirm_delete: "Everything will be deleted permanently. This cannot be undone. Sure?", language: "Language", theme: "Theme",
  error_generic: "Something went wrong. Try again.", back: "Back", loading: "Loading…", cancel: "Cancel", delete: "Delete", close: "Close", open: "Open", plan: "Plan", free: "Free",
};

const DICTS: Record<Locale, Dict> = { ar, en };

interface Ctx {
  locale: Locale;
  dir: "rtl" | "ltr";
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<Ctx>({ locale: "ar", dir: "rtl", setLocale: () => {}, t: (k) => ar[k] ?? k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ar");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cliparab.locale") as Locale | null;
      if (saved === "ar" || saved === "en") setLocaleState(saved);
    } catch { /* storage unavailable */ }
  }, []);
  const dir: "rtl" | "ltr" = locale === "ar" ? "rtl" : "ltr";
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem("cliparab.locale", l); } catch { /* ignore */ }
  }, []);
  const t = useCallback((key: string) => DICTS[locale][key] ?? ar[key] ?? key, [locale]);
  const value = useMemo(() => ({ locale, dir, setLocale, t }), [locale, dir, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

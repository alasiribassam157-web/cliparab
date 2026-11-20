"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "./types";
type Dict = Record<string, string>;
const ar: Dict = {
  app_name: "Vyra",
  tagline: "من الحلقة الطويلة إلى مقاطع جاهزة للنشر — بالعربي",
  nav_projects: "مشاريعي", nav_settings: "الإعدادات", nav_new: "مشروع جديد",
  no_watermark: "بدون علامة مائية",
  phone_note: "على الجوال: أول مرة يحمّل النموذج (يُفضّل Wi-Fi). خلّ الشاشة مفتوحة حتى ينتهي.",
  local_banner: "مجاني بالكامل: الفيديو يُحلَّل ويُقصّ داخل متصفحك، ولا يُرفع إلى أي خادم.",
  local_landing: "مجاني بالكامل وبدون حساب: ارفع حلقتك، ويحلّلها متصفحك ويطلع أقوى المقاطع العمودية مع الترجمة.",
  processing_hint_local: "التحليل يتم داخل متصفحك: أبقِ هذه الصفحة مفتوحة حتى ينتهي. أول مرة يُحمَّل نموذج تفريغ الكلام (مرة واحدة فقط).",
  local_export_note: "التصدير يتم داخل متصفحك وبالسرعة الطبيعية للمقطع؛ أبقِ الصفحة ظاهرة حتى ينتهي.",
  try_sample: "شوف مثالًا حقيقيًا جاهزًا", sample_loading: "جارٍ فتح المثال…",
  showcase_t: "أمثلة حقيقية", showcase_tap: "اضغط على أي مقطع لتسمع الصوت", showcase_open: "افتح المثال كاملًا وجرّب المحرّر",
  showcase_credit: "المصدر: مقابلة «ولاء عبد المنعم» من ويكيميديا كومنز، إعداد Anass (WMF)، برخصة CC BY 3.0. اختار المقاطع وفرّغها محرّك Vyra داخل المتصفح، مع تصحيح يدوي لبعض كلمات الترجمة في المقاطع المعروضة.",
  stage_model: "تحميل نموذج تفريغ الكلام إلى متصفحك (حوالي 250 ميجابايت، مرة واحدة فقط)…",
  url_local_note: "استيراد روابط يوتيوب يحتاج خادمًا مدفوعًا، فهو غير متاح في النسخة المجانية. نزّل الفيديو ثم ارفعه من خيار «ملف».",
  long_video_note: "الفيديوهات الطويلة: نفرّغ أهم 10 دقائق من الكلام فيها فقط لتسريع التحليل.",
  demo_banner: "وضع تجريبي: الموقع غير متصل بخادم المعالجة بعد، لذلك لا يُحلَّل فيديوك أو رابطك — يُعرض مثال جاهز من حلقة نموذجية (المقاطع واللقطات مُنتجة فعليًا بمحرّك Vyra). التحليل الحقيقي يحتاج تشغيل خادم المعالجة.",
  hero_title: "حوّل حلقتك الطويلة إلى مقاطع تُشاهَد حتى النهاية",
  hero_sub: "يختار أقوى لحظات فيديوك، يقصّها عموديًا، ويضيف الترجمة. مجانًا.",
  f1_t: "أفضل اللقطات تلقائيًا", f1_d: "",
  f2_t: "ترجمة عربية وإنجليزية", f2_d: "",
  f3_t: "مجاني بلا حساب", f3_d: "",
  f4_t: "تحميل 1080p فوري", f4_d: "",
  how_t: "كيف يعمل؟", s1: "اختر الفيديو", s2: "نحلّله", s3: "اختر اللقطة", s4: "حمّلها",
  legal_note: "إخلاء مسؤولية: أنت مسؤول عن حقوق أي فيديو ترفعه. التحليل والترجمة آليان وقد يحتويان أخطاء، راجع المقطع قبل نشره. فيديوك يُعالَج داخل متصفحك ولا يُرفع لأي خادم.",
  name: "الاسم",
  projects_title: "مشاريعي", no_projects: "لا توجد مشاريع بعد. ابدأ بمشروعك الأول.",
  start_now: "ابدأ الآن", no_account_title: "بدون حساب", device_note: "لا يوجد تسجيل دخول. مشاريعك مرتبطة بهذا المتصفح فقط؛ إن مسحت بيانات المتصفح أو غيّرت الجهاز فلن تستطيع الوصول إليها. نزّل المقاطع المصدَّرة لتحتفظ بها.",
  server_down: "تعذّر الاتصال بالخادم. تأكد أنه يعمل ثم حاول مجددًا.", retry: "إعادة المحاولة",
  new_title: "مشروع جديد", project_name: "اسم المشروع", pick_video: "اختر فيديو أو اسحبه هنا", pick_srt: "ملف ترجمة SRT/VTT (اختياري، يتجاوز التفريغ)",
  demo_upload_note: "في الوضع التجريبي يُستخدم فيديو نموذجي بدل ملفك.", start_analysis: "ابدأ التحليل", uploading: "جارٍ الرفع…",
  eyebrow: "مجاني بالكامل · يشتغل في متصفحك", src_file: "رفع ملف", src_url: "من رابط", soon: "قريبًا", easy_title: "اصنع مقاطعك", easy_sub: "خطوتين بس، والباقي علينا.", easy_s1: "اختر الفيديو", easy_s2: "الفيديو يتكلم بأي لغة؟", easy_pick: "اضغط هنا لاختيار فيديو", easy_pick_sub: "من جوالك أو جهازك، أو اسحبه هنا", easy_change: "اضغط لتغييره", easy_cap_en: "ترجمة إنجليزية", easy_more: "خيارات إضافية (اختياري)", hero_lead: "حوّل فيديوهاتك الطويلة إلى مقاطع", hero_rot: "تنتشر|تُشاهَد|تبيع|تُبهر", dl_clip: "تحميل", dl_working: "نجهّز المقطع بالترجمة (أبقِ الصفحة مفتوحة)…", dl_ready: "تم: احفظ المقطع", dl_fail: "تعذّر تجهيز المقطع.", translating: "نترجم…", tr_fail: "تعذّرت الترجمة. تأكد من الاتصال بالإنترنت وجرّب مرة ثانية.", cap_lang: "لغة الترجمة على المقطع", cap_ar_tr: "عربية (مترجمة)", stage_translate: "الترجمة للعربية", tr_note: "نفرّغه بالإنجليزي ونترجمه للعربية.", brand_title: "ألوان الهوية", brand_hint: "اختر لونين: يُطبَّقان على الموقع، ولافتة العنوان الافتتاحي، وإبراز الترجمة في المقاطع الجديدة.", brand_a: "اللون الأول", brand_b: "اللون الثاني", brand_reset: "إعادة الافتراضي", brand_sample: "هكذا ستظهر لافتة مقطعك", cap_presets: "أنماط جاهزة (ضغطة وحدة)", hook_on: "عنوان افتتاحي في أول ثواني", hook_ph: "اكتب عنوانًا جاذبًا", filter_all: "الكل", sort_score: "الأعلى تقييمًا", sort_time: "حسب الوقت", top_pick: "الأفضل", lang_label: "لغة الكلام في الفيديو", lang_auto: "تلقائي (يكتشفها النموذج)", lang_note: "اختر لغة الكلام الفعلية في الفيديو.", upload_first: "روابط يوتيوب قريبًا. الحين: حمّل الفيديو على جهازك ثم اختره هنا.", video_url: "رابط الفيديو", video_url_ph: "https://www.youtube.com/watch?v=…",
  url_hint: "يوتيوب وغيره من المواقع العامة. الفيديوهات الخاصة أو المحمية لا تعمل. استخدم فقط فيديوهات تملك حقوقها أو إذنًا باستخدامها.",
  demo_url_note: "في الوضع التجريبي لا يُنزَّل الرابط فعليًا؛ يُستخدم فيديو نموذجي بدله.", downloading: "جارٍ تنزيل الفيديو من الرابط…",
  status_empty: "فارغ", status_ready: "جاهز للتحليل", status_processing: "قيد المعالجة", status_done: "اكتمل", status_error: "خطأ",
  stage_probe: "قراءة الفيديو", stage_transcribe: "تفريغ الكلام", stage_segment: "فهم السياق", stage_score: "تقييم المقاطع", stage_preview: "تجهيز المعاينة", stage_done: "اكتمل",
  processing_title: "نحلّل الحلقة…", processing_hint: "يمكنك إغلاق الصفحة؛ نكمل في الخلفية.",
  suggestions: "المقاطع المقترحة", why_clip: "لماذا هذا المقطع؟", edit: "تحرير", preview_source: "معاينة", transcript: "النص",
  score: "التقييم", dur: "المدة", sec: "ث",
  k_hook: "قوة الافتتاحية", k_complete: "اكتمال الفكرة", k_value: "القيمة", k_audio: "جودة الصوت", k_visual: "الصورة", k_engage: "الإيقاع",
  p_ends_mid_thought: "ينتهي قبل اكتمال الفكرة", p_dangling_start: "يبدأ بإشارة بلا مرجع", p_needs_context: "لا يُفهم وحده", p_low_speech_ratio: "كلام قليل",
  p_low_asr_confidence: "ثقة التفريغ منخفضة", p_bad_duration: "مدة غير مناسبة", p_duration_fit: "مدة بعيدة عن 20–50 ث", p_crosses_topic: "يعبر موضوعين", p_transition_phrase: "عبارة ختام/انتقال",
  type_viral: "الأكثر انتشارًا", type_educational: "تعليمي", type_opinion: "رأي", type_story: "قصة", type_comedy: "كوميدي", type_quote: "اقتباس", type_short: "قصير جدًا", type_marketing: "تسويقي",
  engine_heuristic: "تحليل محلي (بدون Claude)", engine_browser: "تحليل داخل المتصفح", engine_claude: "Claude",
  ed_trim: "القص", ed_emph: "إبراز", ed_layout: "التخطيط", ed_captions: "الترجمة", ed_text: "النص", ed_export: "التصدير",
  start: "البداية", end: "النهاية", layout_fill: "ملء الإطار", layout_fit: "احتواء بخلفية", layout_split: "شاشة مقسومة",
  reframe: "تتبّع الموضوع", reframe_auto: "تلقائي", reframe_note: "", reframe_center: "المنتصف", reframe_manual: "يدوي", center_pos: "موضع الإطار",
  cap_on: "إظهار الترجمة", cap_mode: "النمط", cap_karaoke: "إبراز تدريجي", cap_plain: "عادي", cap_pop: "كلمة كلمة", cap_pos: "الموضع", pos_bottom: "أسفل", pos_middle: "وسط", pos_top: "أعلى",
  cap_size: "حجم الخط", cap_color: "اللون", emphasis_hint: "اضغط على كلمة لإبرازها أو إلغاء إبرازها",
  edit_words_hint: "عدّل الكلمات مباشرة؛ ينعكس ذلك على الترجمة المحروقة.", saved: "تم الحفظ", saving: "جارٍ الحفظ…", conflict: "عُدِّل هذا المقطع في مكان آخر. أعد التحميل.",
  resolution: "الدقة", export_btn: "تصدير المقطع", exporting: "جارٍ التصيير…", download: "تنزيل المقطع",
  demo_export_note: "في الوضع التجريبي يُنزَّل المقطع المُصيَّر مسبقًا بالمحرّك لهذه الاقتراحات.",
  review_link: "رابط مراجعة", copy: "نسخ", copied: "تم النسخ", review_title: "مراجعة المقطع", add_comment: "أضف تعليقًا", your_name: "اسمك", comment: "التعليق", send: "إرسال",
  no_video_yet: "لم يُصدَّر هذا المقطع بعد.", comments: "التعليقات",
  settings_title: "الإعدادات", privacy: "الخصوصية", train_consent: "السماح باستخدام فيديوهاتي لتحسين النماذج", train_hint: "متوقف افتراضيًا. لا يحدث أي تدريب دون موافقتك الصريحة.",
  retention: "مدة الاحتفاظ", days: "يومًا", danger: "منطقة الخطر", delete_project: "حذف المشروع نهائيًا", delete_account: "حذف كل مشاريعي وبياناتي",
  confirm_delete: "سيُحذف كل شيء نهائيًا، ولا يمكن التراجع. متأكد؟", language: "اللغة", theme: "المظهر",
  error_generic: "حدث خطأ. حاول مرة أخرى.", back: "رجوع", loading: "جارٍ التحميل…", cancel: "إلغاء", delete: "حذف", close: "إغلاق", open: "فتح",
};
const en: Dict = {
  app_name: "Vyra",
  tagline: "From long episodes to ready-to-post clips — Arabic first",
  nav_projects: "Projects", nav_settings: "Settings", nav_new: "New project",
  no_watermark: "No watermark",
  phone_note: "On a phone: the model downloads the first time (Wi-Fi recommended). Keep the screen on until it finishes.",
  local_banner: "Completely free: your video is analysed and cut inside your browser and never uploaded to a server.",
  local_landing: "Completely free, no account: upload your episode and your browser finds the strongest vertical clips with captions.",
  processing_hint_local: "Analysis runs inside your browser: keep this page open until it finishes. The first time, the speech model is downloaded (only once).",
  local_export_note: "Export runs inside your browser in real time; keep the page visible until it finishes.",
  try_sample: "Open a real ready-made example", sample_loading: "Opening the example…",
  showcase_t: "Real examples", showcase_tap: "Tap a clip to hear it", showcase_open: "Open the full example and try the editor",
  showcase_credit: "Source: interview with Walaa Abdelmanaem, Wikimedia Commons, by Anass (WMF), CC BY 3.0. Clips chosen and transcribed by Vyra in the browser; a few caption words in the featured clips were corrected by hand.",
  stage_model: "Downloading the speech model to your browser (about 250 MB, only once)…",
  url_local_note: "Importing YouTube links needs a paid server, so it is not available in the free version. Download the video, then upload it with the File option.",
  long_video_note: "Long videos: we transcribe only the most important 10 minutes of speech to keep analysis fast.",
  demo_banner: "Demo mode: the site is not connected to a processing server yet, so your video or link is NOT analysed — a ready-made sample episode is shown instead (clips and frames were really produced by the Vyra engine). Real analysis needs the processing server running.",
  hero_title: "Turn your long episode into clips people watch to the end",
  hero_sub: "Picks your video's strongest moments, cuts them vertical and adds captions. Free.",
  f1_t: "Best moments, automatically", f1_d: "",
  f2_t: "Arabic & English captions", f2_d: "",
  f3_t: "Free, no account", f3_d: "",
  f4_t: "Instant 1080p download", f4_d: "",
  how_t: "How it works", s1: "Choose the video", s2: "We analyse it", s3: "Pick a clip", s4: "Download it",
  legal_note: "Disclaimer: you are responsible for the rights to any video you upload. Analysis and translation are automatic and may contain mistakes; review clips before posting. Your video is processed in your browser and never uploaded.",
  name: "Name",
  projects_title: "My projects", no_projects: "No projects yet. Start with your first one.",
  start_now: "Get started", no_account_title: "No account", device_note: "There is no sign-in. Your projects are tied to this browser only; if you clear browser data or switch devices you will lose access to them. Download exported clips to keep them.",
  server_down: "Cannot reach the server. Make sure it is running and try again.", retry: "Try again",
  new_title: "New project", project_name: "Project name", pick_video: "Choose a video or drop it here", pick_srt: "SRT/VTT subtitles (optional, skips transcription)",
  demo_upload_note: "In demo mode a sample video is used instead of your file.", start_analysis: "Start analysis", uploading: "Uploading…",
  eyebrow: "Completely free · runs in your browser", src_file: "Upload a file", src_url: "From a link", soon: "Soon", easy_title: "Make your clips", easy_sub: "Two steps, we do the rest.", easy_s1: "Choose the video", easy_s2: "What language is spoken?", easy_pick: "Tap here to choose a video", easy_pick_sub: "From your phone or computer, or drop it here", easy_change: "Tap to change it", easy_cap_en: "English captions", easy_more: "More options (optional)", hero_lead: "Turn your long videos into clips that", hero_rot: "go viral|get seen|sell|stun", dl_clip: "Download", dl_working: "Rendering the clip with captions (keep this page open)…", dl_ready: "Done: save the clip", dl_fail: "Could not render the clip.", translating: "Translating…", tr_fail: "Translation failed. Check your connection and try again.", cap_lang: "Caption language", cap_ar_tr: "Arabic (translated)", stage_translate: "Translating to Arabic", tr_note: "We transcribe the English and translate it to Arabic.", brand_title: "Brand colours", brand_hint: "Pick two colours: used across the site, the opening-title banner and the caption highlight of new clips.", brand_a: "First colour", brand_b: "Second colour", brand_reset: "Reset to default", brand_sample: "This is how your clip banner will look", cap_presets: "One-tap styles", hook_on: "Opening title in the first seconds", hook_ph: "Write a catchy title", filter_all: "All", sort_score: "Top score", sort_time: "By time", top_pick: "Top pick", lang_label: "Spoken language in the video", lang_auto: "Auto-detect", lang_note: "Pick the language actually spoken in the video.", upload_first: "Download the video to your device first, then upload it here. Importing from a link is coming soon.", video_url: "Video link", video_url_ph: "https://www.youtube.com/watch?v=…",
  url_hint: "YouTube and other public sites. Private or protected videos won't work. Only use videos you own or have permission to use.",
  demo_url_note: "In demo mode the link is not actually downloaded; a sample video is used instead.", downloading: "Downloading the video from the link…",
  status_empty: "Empty", status_ready: "Ready to analyze", status_processing: "Processing", status_done: "Done", status_error: "Error",
  stage_probe: "Reading video", stage_transcribe: "Transcribing", stage_segment: "Understanding context", stage_score: "Scoring clips", stage_preview: "Preparing preview", stage_done: "Done",
  processing_title: "Analyzing your episode…", processing_hint: "You can close this page; we keep working in the background.",
  suggestions: "Suggested clips", why_clip: "Why this clip?", edit: "Edit", preview_source: "Preview", transcript: "Transcript",
  score: "Score", dur: "Length", sec: "s",
  k_hook: "Hook strength", k_complete: "Idea completeness", k_value: "Value", k_audio: "Audio quality", k_visual: "Visual", k_engage: "Pacing",
  p_ends_mid_thought: "Ends before the idea is finished", p_dangling_start: "Opens with an unresolved reference", p_needs_context: "Not understandable on its own", p_low_speech_ratio: "Little speech",
  p_low_asr_confidence: "Low transcription confidence", p_bad_duration: "Unsuitable length", p_duration_fit: "Far from 20–50 s", p_crosses_topic: "Crosses two topics", p_transition_phrase: "Outro / transition phrase",
  type_viral: "Most shareable", type_educational: "Educational", type_opinion: "Opinion", type_story: "Story", type_comedy: "Comedy", type_quote: "Quote", type_short: "Very short", type_marketing: "Marketing",
  engine_heuristic: "Local analysis (no Claude)", engine_browser: "In-browser analysis", engine_claude: "Claude",
  ed_trim: "Trim", ed_emph: "Emphasis", ed_layout: "Layout", ed_captions: "Captions", ed_text: "Text", ed_export: "Export",
  start: "Start", end: "End", layout_fill: "Fill frame", layout_fit: "Fit with blur", layout_split: "Split screen",
  reframe: "Subject tracking", reframe_auto: "Auto", reframe_note: "", reframe_center: "Center", reframe_manual: "Manual", center_pos: "Frame position",
  cap_on: "Show captions", cap_mode: "Style", cap_karaoke: "Word highlight", cap_plain: "Plain", cap_pop: "Word by word", cap_pos: "Position", pos_bottom: "Bottom", pos_middle: "Middle", pos_top: "Top",
  cap_size: "Font size", cap_color: "Color", emphasis_hint: "Click a word to emphasize or un-emphasize it",
  edit_words_hint: "Edit words directly; changes are burned into the captions.", saved: "Saved", saving: "Saving…", conflict: "This clip was changed elsewhere. Reload.",
  resolution: "Resolution", export_btn: "Export clip", exporting: "Rendering…", download: "Download clip",
  demo_export_note: "In demo mode the pre-rendered clip for these suggestions is downloaded.",
  review_link: "Review link", copy: "Copy", copied: "Copied", review_title: "Clip review", add_comment: "Add a comment", your_name: "Your name", comment: "Comment", send: "Send",
  no_video_yet: "This clip has not been exported yet.", comments: "Comments",
  settings_title: "Settings", privacy: "Privacy", train_consent: "Allow my videos to improve models", train_hint: "Off by default. Nothing is used for training without your explicit consent.",
  retention: "Retention", days: "days", danger: "Danger zone", delete_project: "Delete project permanently", delete_account: "Delete all my projects and data",
  confirm_delete: "Everything will be deleted permanently. This cannot be undone. Sure?", language: "Language", theme: "Theme",
  error_generic: "Something went wrong. Try again.", back: "Back", loading: "Loading…", cancel: "Cancel", delete: "Delete", close: "Close", open: "Open",
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

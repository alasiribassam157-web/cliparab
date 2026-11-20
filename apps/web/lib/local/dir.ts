/** Share of letters that are right-to-left script (Arabic, Hebrew, Syriac, Thaana). */
export function rtlShare(text: string): number {
  let rtl = 0, ltr = 0;
  for (const ch of text) {
    if (/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(ch)) rtl++;
    else if (/\p{L}/u.test(ch)) ltr++;
  }
  return rtl + ltr ? rtl / (rtl + ltr) : 1;
}
export const isRtl = (text: string) => rtlShare(text) >= 0.5;

/** Whisper language names for the codes offered in the UI; "auto" lets the model detect it. */
export const WHISPER_LANG: Record<string, string | undefined> = {
  auto: undefined, ar: "arabic", en: "english", fr: "french", es: "spanish", tr: "turkish", ur: "urdu", hi: "hindi", id: "indonesian",
};

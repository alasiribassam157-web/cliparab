import type { MetadataRoute } from "next";

/** Installable web app: "Add to Home screen" on phones opens Vyra full-screen like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vyra — مقاطع تنتشر من فيديوهاتك الطويلة",
    short_name: "Vyra",
    description: "حوّل الفيديو الطويل إلى مقاطع قصيرة عمودية بترجمة عربية، مجانًا وداخل متصفحك.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#03040c",
    theme_color: "#03040c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

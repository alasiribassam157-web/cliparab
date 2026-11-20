import type { MetadataRoute } from "next";

/** Installable web app: "Add to Home screen" on phones opens ClipArab full-screen like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ClipArab — مقاطع قصيرة من فيديوهاتك الطويلة",
    short_name: "ClipArab",
    description: "حوّل الفيديو الطويل إلى مقاطع قصيرة عمودية بترجمة عربية، مجانًا وداخل متصفحك.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#0b0b12",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

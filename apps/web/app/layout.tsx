import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { BackendProvider } from "@/lib/backend";

const font = Tajawal({ subsets: ["arabic", "latin"], weight: ["400", "500", "700", "800"], display: "swap", variable: "--font-ui" });

export const metadata: Metadata = {
  title: "ClipArab — مقاطع قصيرة من فيديوهاتك الطويلة",
  description: "منصة عربية تحوّل الفيديو الطويل إلى مقاطع قصيرة جاهزة لـ TikTok وReels وShorts، بترجمة عربية سليمة ومجانًا بلا علامة مائية.",
};
export const viewport: Viewport = { themeColor: "#4f46e5", width: "device-width", initialScale: 1 };

const themeInit = `try{var t=localStorage.getItem('cliparab.theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={font.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body>
        <I18nProvider>
          <BackendProvider>{children}</BackendProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import { BackendProvider } from "@/lib/backend";
import { Motion } from "@/components/Motion";

const font = Tajawal({ subsets: ["arabic", "latin"], weight: ["400", "500", "700", "800"], display: "swap", variable: "--font-ui" });

export const metadata: Metadata = {
  title: "ClipArab — مقاطع قصيرة من فيديوهاتك الطويلة",
  description: "منصة عربية تحوّل الفيديو الطويل إلى مقاطع قصيرة جاهزة لـ TikTok وReels وShorts، بترجمة عربية سليمة ومجانًا بلا علامة مائية.",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "ClipArab", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#07060f", width: "device-width", initialScale: 1, viewportFit: "cover" };

const themeInit = `try{var t=localStorage.getItem('cliparab.theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={font.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body>
        <div className="aurora" aria-hidden><i /><i /><i /></div>
        <Motion />
        <I18nProvider>
          <BackendProvider>{children}</BackendProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

/** IBM Plex Sans Arabic covers Arabic and Latin with matched weights and rhythm. */
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-plex" });

export const metadata: Metadata = {
  title: { default: "محمد | التقني", template: "%s · محمد | التقني" },
  description: "مساعد تقني بدون قيود — مخصّص للاختبارات السيبرانية",
  applicationName: "محمد | التقني",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "محمد | التقني", statusBarStyle: "black-translucent" },
  openGraph: { title: "محمد | التقني", description: "مساعد تقني بدون قيود — مخصّص للاختبارات السيبرانية", type: "website", locale: "ar_SA", siteName: "محمد | التقني" },
  twitter: { card: "summary", title: "محمد | التقني", description: "مساعد تقني بدون قيود — مخصّص للاختبارات السيبرانية" },
};
// Fixed like a native chat app: no tap/focus zoom, content resizes above the on-screen keyboard.
export const viewport: Viewport = { themeColor: "#050812", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`dark ${plex.variable}`}>
      <body className={plex.className}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

/** IBM Plex Sans Arabic covers Arabic and Latin with matched weights and rhythm. */
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-plex" });

export const metadata: Metadata = {
  title: { default: "JB AI — اسأل أي شي", template: "%s · JB AI" },
  description: "JB AI: دردش مع أقوى نماذج الذكاء الاصطناعي. مساعدة في البرمجة والأسئلة التقنية وأكثر.",
};
export const viewport: Viewport = { themeColor: "#050812", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`dark ${plex.variable}`}>
      <body className={plex.className}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

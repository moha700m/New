import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Agentsii — بوابة أرصدة العملاء", template: "%s | Agentsii" },
  description: "Agentsii: استعلم عن رصيدك المتبقي بأمان باستخدام رقم العميل ورمز PIN.",
  applicationName: "Agentsii",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#05050a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={arabic.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

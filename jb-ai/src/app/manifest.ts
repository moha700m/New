import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "محمد | التقني",
    short_name: "محمد التقني",
    description: "مساعد تقني بدون قيود — مخصّص للاختبارات السيبرانية",
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    background_color: "#050812",
    theme_color: "#050812",
  };
}

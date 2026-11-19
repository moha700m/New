import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: { 950: "#050812", 900: "#070b18", 850: "#0a1020", 800: "#0d1428", 700: "#141d36", 600: "#1d2846", 500: "#2a3759" },
        brand: { 400: "#7aa2ff", 500: "#5b8cff", 600: "#3f6fe8" },
      },
      fontFamily: { sans: ["var(--font-plex)", "IBM Plex Sans Arabic", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"] },
    },
  },
  plugins: [typography],
} satisfies Config;

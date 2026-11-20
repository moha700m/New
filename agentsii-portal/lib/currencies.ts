export const CURRENCIES = ["USD", "SAR", "AED", "KWD", "QAR", "BHD", "OMR", "EGP", "JOD", "EUR", "GBP", "TRY"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: "دولار أمريكي",
  SAR: "ريال سعودي",
  AED: "درهم إماراتي",
  KWD: "دينار كويتي",
  QAR: "ريال قطري",
  BHD: "دينار بحريني",
  OMR: "ريال عماني",
  EGP: "جنيه مصري",
  JOD: "دينار أردني",
  EUR: "يورو",
  GBP: "جنيه إسترليني",
  TRY: "ليرة تركية",
};

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

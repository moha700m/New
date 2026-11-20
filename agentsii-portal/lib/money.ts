const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** Converts Arabic-Indic / Persian digits and Arabic separators to ASCII. */
export function normalizeDigits(input: string): string {
  return input
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/[٫]/g, ".")
    .replace(/[٬،,\s]/g, "")
    .replace(/[−–]/g, "-");
}

const MAX_MINOR = 10 ** 15; // 10 trillion with 2 decimals; well within Number.MAX_SAFE_INTEGER

/**
 * Parses a user-entered amount ("1,250.5", "-30", "١٢٥٠") into minor units (cents).
 * Returns null when the value is not a valid amount with at most 2 decimals.
 */
export function parseAmountToMinor(input: string, { allowNegative = true } = {}): number | null {
  const s = normalizeDigits(input.trim());
  const m = /^(-)?(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  if (m[1] && !allowNegative) return null;
  const minor = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (minor > MAX_MINOR) return null;
  return m[1] ? -minor : minor;
}

export function formatMoney(minor: number, currency: string, { signed = false } = {}): string {
  return new Intl.NumberFormat("ar-u-nu-latn", {
    style: "currency",
    currency,
    signDisplay: signed ? "exceptZero" : "auto",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ar-u-nu-latn-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

import { CURRENCIES, CURRENCY_LABELS } from "@/lib/currencies";
import type { CustomerStatus } from "@/lib/db";

export function StatusBadge({ status }: { status: CustomerStatus }) {
  return status === "active" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden /> نشط
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-300">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden /> موقوف
    </span>
  );
}

export function CurrencySelect({ id, defaultValue }: { id: string; defaultValue: string }) {
  return (
    <select id={id} name="currency" defaultValue={defaultValue} className="input">
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {CURRENCY_LABELS[c]} ({c})
        </option>
      ))}
    </select>
  );
}

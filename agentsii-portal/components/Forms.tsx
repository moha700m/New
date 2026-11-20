"use client";

import { createContext, useContext } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/validation";

/** Set by ActionForm, which submits without a native form action. */
export const PendingContext = createContext<boolean | null>(null);

export function SubmitButton({
  children,
  pendingText = "جارٍ التنفيذ…",
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
}) {
  const status = useFormStatus();
  const ctx = useContext(PendingContext);
  const pending = ctx ?? status.pending;
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost";
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${cls} ${className}`}>
      {pending && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {pending ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state.error && !state.message) return null;
  const isError = !!state.error;
  return (
    <p
      key={state.at}
      role={isError ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${
        isError
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      {state.error ?? state.message}
    </p>
  );
}

"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";
import type { FormState } from "@/lib/validation";
import { FormMessage, PendingContext } from "./Forms";

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  /** Clear the fields after a successful submit (e.g. "add customer"). */
  resetOnSuccess?: boolean;
  /** Ask for confirmation before submitting. */
  confirmText?: string;
  /** Where to show the result message. */
  messagePosition?: "top" | "bottom";
};

/**
 * Wraps a server action. Submits via onSubmit so React does not wipe the fields
 * when the server returns a validation error.
 */
export function ActionForm({ action, children, className, resetOnSuccess, confirmText, messagePosition = "bottom" }: Props) {
  const [state, dispatch, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      className={className}
      noValidate
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => dispatch(fd));
      }}
    >
      <PendingContext value={pending}>
        {messagePosition === "top" && <div className="mb-4 empty:hidden"><FormMessage state={state} /></div>}
        {children}
        {messagePosition === "bottom" && <div className="mt-4 empty:hidden"><FormMessage state={state} /></div>}
      </PendingContext>
    </form>
  );
}

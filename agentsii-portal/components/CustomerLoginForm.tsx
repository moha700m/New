"use client";

import { customerLogin } from "@/app/actions/customer";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./Forms";

export function CustomerLoginForm() {
  return (
    <ActionForm action={customerLogin} className="space-y-4" messagePosition="top">
      <div>
        <label htmlFor="number" className="label">رقم العميل</label>
        <input
          id="number"
          name="number"
          inputMode="numeric"
          autoComplete="username"
          placeholder="مثال: 100245"
          className="input ltr-nums text-right"
          maxLength={20}
          required
        />
      </div>
      <div>
        <label htmlFor="pin" className="label">رمز PIN</label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="••••"
          className="input ltr-nums text-right tracking-[0.4em]"
          maxLength={8}
          required
        />
      </div>
      <SubmitButton className="w-full py-3 text-base" pendingText="جارٍ التحقق…">
        عرض الرصيد
      </SubmitButton>
    </ActionForm>
  );
}

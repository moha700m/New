"use client";

import { adminLogin } from "@/app/actions/admin";
import { ActionForm } from "./ActionForm";
import { SubmitButton } from "./Forms";

export function AdminLoginForm() {
  return (
    <ActionForm action={adminLogin} className="space-y-4" messagePosition="top">
      <input type="text" name="username" autoComplete="username" value="Agentsii admin" readOnly hidden />
      <div>
        <label htmlFor="password" className="label">كلمة مرور الإدارة</label>
        <input id="password" name="password" type="password" autoComplete="current-password" className="input" required autoFocus />
      </div>
      <SubmitButton className="w-full py-3" pendingText="جارٍ التحقق…">دخول لوحة الإدارة</SubmitButton>
    </ActionForm>
  );
}

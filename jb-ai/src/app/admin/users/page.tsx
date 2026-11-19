"use client";
import { useState } from "react";
import { api, fmtDate } from "@/components/api";
import { PageHeader, Table, useAction, useAdmin } from "@/components/admin/ui";
import { Modal } from "@/components/ui/Modal";

interface U { id: string; email: string; name: string | null; role: string; emailVerifiedAt: string | null; disabled: boolean; createdAt: string; subscription: { status: string; provider: string; currentPeriodEnd: string | null; plan: { key: string; name: string } } | null; _count: { conversations: number; usage: number } }

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data, reload } = useAdmin<{ users: U[]; total: number }>(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`);
  const plans = useAdmin<{ plans: { key: string; name: string }[] }>("/api/admin/plans");
  const { run } = useAction();
  const [grant, setGrant] = useState<U | null>(null);
  const [grantPlan, setGrantPlan] = useState("pro");
  const [grantDays, setGrantDays] = useState(30);
  const patch = (u: U, body: Record<string, unknown>, msg: string) => run(u.id, () => api(`/api/admin/users/${u.id}`, { method: "PATCH", body }), msg).then(() => reload());

  return (
    <>
      <PageHeader title="المستخدمون" subtitle={`${data?.total ?? 0} حساب`} actions={
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); setPage(1); }}>
          <input className="input" placeholder="ابحث بالبريد أو الاسم" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn-outline">بحث</button>
        </form>
      } />
      <Table head={["المستخدم", "الدور", "الباقة", "النشاط", "تاريخ الانضمام", ""]} empty={data?.users.length === 0}>
        {data?.users.map((u) => (
          <tr key={u.id} className="align-top">
            <td className="px-3 py-2.5">
              <div className="font-medium"><bdi dir="ltr">{u.email}</bdi></div>
              <div className="text-xs text-slate-500"><bdi>{u.name ?? "—"}</bdi> · {u.emailVerifiedAt ? "مؤكَّد" : "غير مؤكَّد"}{u.disabled && <span className="text-red-300"> · معطّل</span>}</div>
            </td>
            <td className="px-3 py-2.5 text-xs">{({ OWNER: "المالك", ADMIN: "مسؤول", USER: "مستخدم" } as Record<string, string>)[u.role] ?? u.role}</td>
            <td className="px-3 py-2.5 text-xs">{u.subscription ? `${u.subscription.plan.name} (${u.subscription.status === "ACTIVE" ? "نشط" : u.subscription.status}، ${u.subscription.provider === "manual" ? "يدوي" : u.subscription.provider})` : "مجانية"}{u.subscription?.currentPeriodEnd && <div className="text-slate-500">حتى {fmtDate(u.subscription.currentPeriodEnd)}</div>}</td>
            <td className="px-3 py-2.5 text-xs text-slate-400">{u._count.conversations} محادثة · {u._count.usage} طلب</td>
            <td className="px-3 py-2.5 text-xs">{fmtDate(u.createdAt)}</td>
            <td className="px-3 py-2.5">
              {u.role !== "OWNER" && (
                <div className="flex flex-wrap justify-end gap-1">
                  {!u.emailVerifiedAt && <button className="btn-outline px-2 py-1 text-xs" onClick={() => patch(u, { verifyEmail: true }, "تم تأكيد البريد")}>تأكيد البريد</button>}
                  <button className="btn-outline px-2 py-1 text-xs" onClick={() => patch(u, { role: u.role === "ADMIN" ? "USER" : "ADMIN" }, "تم تحديث الدور")}>{u.role === "ADMIN" ? "سحب صلاحية المسؤول" : "تعيين كمسؤول"}</button>
                  <button className="btn-outline px-2 py-1 text-xs" onClick={() => setGrant(u)}>منح باقة</button>
                  <button className="btn-outline px-2 py-1 text-xs" onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? "تم تفعيل المستخدم" : "تم تعطيل المستخدم")}>{u.disabled ? "تفعيل" : "تعطيل"}</button>
                  <button className="btn-ghost px-2 py-1 text-xs text-red-300" onClick={() => confirm(`حذف ${u.email} وكل بياناته؟`) && run("d", () => api(`/api/admin/users/${u.id}`, { method: "DELETE" }), "تم حذف المستخدم").then(() => reload())}>حذف</button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-outline px-2.5 py-1" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="btn-outline px-2.5 py-1" disabled={(data?.users.length ?? 0) < 50} onClick={() => setPage(page + 1)}>التالي</button>
      </div>
      <Modal open={!!grant} onClose={() => setGrant(null)} title={`منح باقة لـ ${grant?.email ?? ""}`}>
        <p className="mb-3 text-sm text-slate-400">وصول يدوي مجاني، مثلًا للدعم أو التجربة. الاشتراكات المدفوعة يديرها مزوّد الدفع.</p>
        <div className="grid grid-cols-2 gap-3">
          <select className="input" value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)}>{plans.data?.plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
          <input className="input" type="number" min={1} value={grantDays} onChange={(e) => setGrantDays(Number(e.target.value))} aria-label="عدد الأيام" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => { patch(grant!, { grantPlanKey: null }, "تم إلغاء المنح اليدوي"); setGrant(null); }}>إلغاء المنح</button>
          <button className="btn-primary" onClick={() => { patch(grant!, { grantPlanKey: grantPlan, grantDays }, `تم منح ${grantPlan} لمدة ${grantDays} يوم`); setGrant(null); }}>منح</button>
        </div>
      </Modal>
    </>
  );
}

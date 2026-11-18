"use client";
import { useState } from "react";
import { fmtDate } from "@/components/api";
import { PageHeader, Table, useAdmin } from "@/components/admin/ui";

interface Log { id: string; createdAt: string; actorEmail: string | null; action: string; entityType: string | null; entityId: string | null; details: unknown; ip: string | null }

export default function AuditPage() {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useAdmin<{ logs: Log[]; total: number }>(`/api/admin/audit?action=${encodeURIComponent(filter)}&page=${page}`);
  return (
    <>
      <PageHeader title="الأمان وسجل التدقيق" subtitle="يُسجَّل كل تعديل إداري، وكل تغيير لمفاتيح الوصول، وكل إشعار دفع." actions={
        <select className="input w-auto" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
          <option value="">كل الإجراءات</option>
          {["provider", "model", "routing", "plan", "user", "settings", "payments", "billing"].map((a) => <option key={a} value={a}>{a}.*</option>)}
        </select>
      } />
      <Table head={["الوقت", "المنفّذ", "الإجراء", "العنصر", "التفاصيل", "IP"]} empty={!data?.logs.length}>
        {data?.logs.map((l) => (
          <tr key={l.id} className="align-top">
            <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDate(l.createdAt, true)}</td>
            <td className="px-3 py-2 text-xs"><bdi dir="ltr">{l.actorEmail ?? "system"}</bdi></td>
            <td dir="ltr" className="px-3 py-2 text-start font-mono text-xs">{l.action}</td>
            <td className="px-3 py-2 text-xs">{l.entityType}{l.entityId && <div className="font-mono text-slate-500">{l.entityId.slice(0, 12)}</div>}</td>
            <td className="max-w-md px-3 py-2"><pre dir="ltr" className="max-h-32 text-start overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-400">{l.details ? JSON.stringify(l.details, null, 1) : ""}</pre></td>
            <td className="px-3 py-2 text-xs">{l.ip}</td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <span className="text-slate-500">{data?.total ?? 0} سجل</span>
        <button className="btn-outline px-2.5 py-1" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="btn-outline px-2.5 py-1" disabled={(data?.logs.length ?? 0) < 100} onClick={() => setPage(page + 1)}>التالي</button>
      </div>
    </>
  );
}

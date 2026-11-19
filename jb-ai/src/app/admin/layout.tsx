import { redirect } from "next/navigation";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

/** Server-side guard: only ADMIN/OWNER roles reach any admin page (API routes enforce the same check). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdminRole(user.role)) redirect("/");
  return <AdminShell user={{ email: user.email, role: user.role }}>{children}</AdminShell>;
}

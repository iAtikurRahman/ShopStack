import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import { LogoutButton } from "@/components/LogoutButton";
import { AdGate } from "@/components/AdGate";
import { WorkspaceNav } from "@/components/WorkspaceNav";

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  let name: string;
  let role: "company_admin" | "store_manager";
  try {
    const { session } = await requireTenantSession({ roles: ["company_admin", "store_manager"] });
    name = session.name;
    role = session.role === "store_manager" ? "store_manager" : "company_admin";
  } catch (err) {
    if (err instanceof ApiError) redirect("/login");
    throw err;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/company">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">ShopStack</p>
              <p className="text-lg font-semibold text-slate-950">Company Admin</p>
            </Link>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-500">{name}</span>
              <LogoutButton redirectTo="/login" />
            </div>
          </div>
          <WorkspaceNav role={role} />
        </div>
      </header>
      <AdGate role={role} />
      <main>{children}</main>
    </div>
  );
}
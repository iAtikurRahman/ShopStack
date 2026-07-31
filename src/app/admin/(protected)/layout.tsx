import Link from "next/link";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/session";
import { LogoutButton } from "@/components/LogoutButton";

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession();

  // proxy.ts already redirected unauthenticated visits before this rendered;
  // this is the authoritative (DAL) check, done again here since layouts
  // aren't re-run on every client-side navigation. This layout only wraps
  // routes inside the (protected) group - /admin/login sits outside it, so
  // an unauthenticated visit to the login page itself never hits this
  // check (that was the earlier infinite-redirect bug: the guard used to
  // wrap /admin/login too, redirecting it to itself forever).
  if (!session || session.kind !== "project_admin") {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">ShopStack</p>
            <p className="text-lg font-semibold">Project Admin</p>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/admin/companies" className="hover:underline">
              Companies
            </Link>
            <Link href="/admin/subscriptions" className="hover:underline">
              Subscriptions
            </Link>
            <Link href="/admin/reports" className="hover:underline">
              Reports
            </Link>
            <Link href="/admin/audit-log" className="hover:underline">
              Audit log
            </Link>
            <span className="text-slate-400">{session.name}</span>
            <LogoutButton
              redirectTo="/admin/login"
              className="rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            />
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import { LogoutButton } from "@/components/LogoutButton";

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  let name: string;
  try {
    const { session } = await requireTenantSession({ roles: ["company_admin"] });
    name = session.name;
  } catch (err) {
    if (err instanceof ApiError) redirect("/login");
    throw err;
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">ShopStack</p>
            <p className="text-lg font-semibold text-slate-950">Company Admin</p>
          </div>
          <nav className="flex items-center gap-6 text-sm text-slate-700">
            <Link href="/company" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/company/stores" className="hover:underline">
              Stores
            </Link>
            <Link href="/company/products" className="hover:underline">
              Products
            </Link>
            <Link href="/company/categories" className="hover:underline">
              Categories
            </Link>
            <Link href="/company/customers" className="hover:underline">
              Customers
            </Link>
            <Link href="/company/reports" className="hover:underline">
              Reports
            </Link>
            <Link href="/company/users" className="hover:underline">
              Users
            </Link>
            <Link href="/company/audit-log" className="hover:underline">
              Audit log
            </Link>
            <span className="text-slate-500">{name}</span>
            <LogoutButton redirectTo="/login" />
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

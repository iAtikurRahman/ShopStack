import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiError, requireTenantSession } from "@/lib/session";
import { LogoutButton } from "@/components/LogoutButton";
import { AdGate } from "@/components/AdGate";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  let name: string;
  let isManager: boolean;
  try {
    const { session } = await requireTenantSession({ roles: ["store_manager", "store_user"] });
    name = session.name;
    isManager = session.role === "store_manager";
  } catch (err) {
    if (err instanceof ApiError) redirect("/login");
    throw err;
  }
  const role = isManager ? "store_manager" : "store_user";

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">ShopStack</p>
            <p className="text-lg font-semibold text-slate-950">Store</p>
          </div>
          <nav className="flex items-center gap-6 text-sm text-slate-700">
            <Link href="/store" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/store/pos" className="hover:underline">
              Checkout
            </Link>
            <Link href="/store/sales" className="hover:underline">
              Sales
            </Link>
            <Link href="/store/returns" className="hover:underline">
              Returns
            </Link>
            <Link href="/store/customers" className="hover:underline">
              Customers
            </Link>
            <Link href="/store/inventory" className="hover:underline">
              Inventory
            </Link>
            <Link href="/store/transfers" className="hover:underline">
              Transfers
            </Link>
            <Link href="/store/purchases" className="hover:underline">
              Purchases
            </Link>
            <Link href="/store/supplier-returns" className="hover:underline">
              Supplier returns
            </Link>
            {isManager ? (
              <Link href="/store/reports" className="hover:underline">
                Reports
              </Link>
            ) : null}
            {isManager ? (
              <Link href="/store/users" className="hover:underline">
                Users
              </Link>
            ) : null}
            <span className="text-slate-500">{name}</span>
            <LogoutButton redirectTo="/login" />
          </nav>
        </div>
      </header>
      <AdGate role={role} />
      <main>{children}</main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthToken, getAuthUser, logout } from "@/services/api";

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const currentUser = getAuthUser();
    setUser(currentUser);
    setIsReady(true);
  }, [router]);

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-xl">
          <p className="text-lg font-semibold">Checking authentication…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="w-full max-w-xs rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-8">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">ShopStack</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">{title}</h1>
          </div>
          <div className="space-y-1">
            {[
              { href: "/dashboard", label: "Dashboard" },
              { href: "/shops", label: "Shops" },
              { href: "/products", label: "Products" },
              { href: "/sales", label: "Sales" },
              { href: "/expenses", label: "Expenses" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-2xl px-4 py-3 text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Logged in as</p>
            <p className="mt-2 text-lg font-semibold text-slate-900">{user?.name || "User"}</p>
            <p className="text-sm text-slate-500">{user?.role || "staff"}</p>
            <button
              type="button"
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="mt-4 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Logout
            </button>
          </div>
        </aside>

        <main className="flex-1 space-y-6">{children}</main>
      </div>
    </div>
  );
}

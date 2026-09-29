"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/services/api";

type Sale = {
  id: number;
  totalAmount: string;
  status: string;
  createdAt: string;
  customer: { name: string } | null;
};

export default function StoreSalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((sale) => {
      const digits = q.replace(/\D/g, "");
      return (
        String(sale.id).includes(q) ||
        (sale.customer?.name ?? "").toLowerCase().includes(q) ||
        sale.totalAmount.includes(q) ||
        sale.status.toLowerCase().includes(q) ||
        sale.createdAt.slice(0, 10).includes(q) ||
        (digits.length > 0 && sale.totalAmount.replace(/\D/g, "").includes(digits))
      );
    });
  }, [sales, search]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<{ sales: Sale[] }>("/api/store/sales");
        setSales(data.sales);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Sales</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by sale #, customer, amount, status or date…"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
        />
        {loading ? (
          <p className="mt-6 text-sm text-slate-600">Loading…</p>
        ) : filteredSales.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">
            {search.trim() ? `No sales match "${search.trim()}".` : "No sales yet."}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {filteredSales.map((sale) => (
              <Link
                key={sale.id}
                href={`/store/sales/${sale.id}`}
                className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300"
              >
                <div>
                  <p className="font-semibold text-slate-950">Sale #{sale.id}</p>
                  <p className="text-xs text-slate-500">
                    {sale.customer?.name ?? "Walk-in"} · {new Date(sale.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-slate-950">${sale.totalAmount}</p>
                  <p className="text-xs text-slate-500">{sale.status}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

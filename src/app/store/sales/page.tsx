"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
        {loading ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : sales.length === 0 ? (
          <p className="text-sm text-slate-600">No sales yet.</p>
        ) : (
          <div className="space-y-3">
            {sales.map((sale) => (
              <Link
                key={sale.id}
                href={`/store/sales/${sale.id}`}
                className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300"
              >
                <div>
                  <p className="font-semibold text-slate-950">Sale #{sale.id}</p>
                  <p className="text-xs text-slate-500">{sale.customer?.name ?? "Walk-in"}</p>
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

"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Report = {
  totalSales: string | number;
  totalRefunds: string | number;
  salesCount: number;
  topProducts: { product: { sku: string; name: string } | null; quantitySold: number; revenue: string | number }[];
  lowStockItems: { product: { sku: string; name: string }; quantity: number; lowStockThreshold: number }[];
};

export default function StoreReportsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<Report>("/api/store/reports");
        setReport(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <main className="p-8 text-sm text-slate-600">Loading…</main>;
  if (error || !report) return <main className="p-8 text-sm text-red-600">{error ?? "Not available"}</main>;

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Store reports</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Total sales</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">${report.totalSales}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Total refunds</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">${report.totalRefunds}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Sales count</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{report.salesCount}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Top products</h2>
          {report.topProducts.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">No sales yet.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {report.topProducts.map((p, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-950">{p.product?.name ?? "Unknown product"}</span>
                  <span className="text-slate-600">{p.quantitySold} sold · ${p.revenue}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Low stock</h2>
          {report.lowStockItems.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">Nothing low on stock.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {report.lowStockItems.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-950">{item.product.name}</span>
                  <span className="font-medium text-red-600">
                    {item.quantity} / {item.lowStockThreshold}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

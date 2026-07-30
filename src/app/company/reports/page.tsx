"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type Report = {
  totalSales: string | number;
  totalRefunds: string | number;
  salesCount: number;
  lowStockCount: number;
  byStore: { storeId: number; storeName: string; totalSales: string | number; salesCount: number }[];
  staffPerformance: { cashierId: number; cashierName: string; totalSales: string | number; salesCount: number }[];
  topProducts: { product: { name: string } | null; quantitySold: number; revenue: string | number }[];
};

export default function CompanyReportsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await apiFetch<Report>("/api/company/reports");
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
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">Company reports</h1>

      <div className="grid gap-4 sm:grid-cols-4">
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
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Low stock items</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{report.lowStockCount}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">By store</h2>
          <div className="mt-4 space-y-2">
            {report.byStore.map((row) => (
              <div key={row.storeId} className="flex justify-between text-sm">
                <span className="text-slate-950">{row.storeName}</span>
                <span className="text-slate-600">${row.totalSales} · {row.salesCount}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Staff performance</h2>
          <div className="mt-4 space-y-2">
            {report.staffPerformance.map((row) => (
              <div key={row.cashierId} className="flex justify-between text-sm">
                <span className="text-slate-950">{row.cashierName}</span>
                <span className="text-slate-600">${row.totalSales} · {row.salesCount}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Top products</h2>
          <div className="mt-4 space-y-2">
            {report.topProducts.map((p, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-slate-950">{p.product?.name ?? "Unknown"}</span>
                <span className="text-slate-600">{p.quantitySold} · ${p.revenue}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

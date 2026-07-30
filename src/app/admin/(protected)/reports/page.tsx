"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/services/api";

type CompanyRow = {
  id: number;
  name: string;
  slug: string;
  status: string;
  metrics: {
    totalSales: string;
    totalRefunds: string;
    salesCount: number;
    storeCount: number;
    userCount: number;
    refreshedAt: string;
  } | null;
};

type Report = {
  companyCount: number;
  activeCount: number;
  totals: { totalSales: number; totalRefunds: number; salesCount: number };
  companies: CompanyRow[];
};

export default function AdminReportsPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    try {
      const data = await apiFetch<Report>("/api/admin/reports");
      setReport(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      await loadReport();
    }
    load();
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await apiFetch("/api/admin/reports/refresh", "POST");
      await loadReport();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <main className="p-8 text-sm text-slate-400">Loading…</main>;
  if (error || !report) return <main className="p-8 text-sm text-red-400">{error ?? "Not available"}</main>;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-950">Cross-company reports</h1>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh snapshot"}
        </button>
      </div>
      <p className="text-sm text-slate-600">
        Figures come from the periodic rollup snapshot, not a live query across every tenant database.
      </p>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Companies</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{report.companyCount}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Active</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{report.activeCount}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Total revenue</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">${report.totals.totalSales.toFixed(2)}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Total sales</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{report.totals.salesCount}</p>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">By company</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2">Company</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Sales</th>
                <th className="pb-2">Refunds</th>
                <th className="pb-2">Stores</th>
                <th className="pb-2">Users</th>
                <th className="pb-2">Refreshed</th>
              </tr>
            </thead>
            <tbody>
              {report.companies.map((company) => (
                <tr key={company.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-950">{company.name}</td>
                  <td className="py-2 text-slate-600">{company.status}</td>
                  <td className="py-2 text-slate-600">${company.metrics?.totalSales ?? "0.00"}</td>
                  <td className="py-2 text-slate-600">${company.metrics?.totalRefunds ?? "0.00"}</td>
                  <td className="py-2 text-slate-600">{company.metrics?.storeCount ?? "—"}</td>
                  <td className="py-2 text-slate-600">{company.metrics?.userCount ?? "—"}</td>
                  <td className="py-2 text-slate-500">
                    {company.metrics ? new Date(company.metrics.refreshedAt).toLocaleString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

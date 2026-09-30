"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Report = {
  totalSales: string | number;
  totalRefunds: string | number;
  salesCount: number;
  topProducts: { product: { sku: string; name: string } | null; quantitySold: number; revenue: string | number }[];
  lowStockItems: { product: { sku: string; name: string }; quantity: number; lowStockThreshold: number }[];
};

export default function StoreReportsPage() {
  const { t, fmt } = useI18n();
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

  if (loading) return <main className="p-8 text-sm text-slate-600">{t("common.loading")}</main>;
  if (error || !report)
    return <main className="p-8 text-sm text-red-600">{error ?? t("storeOps.reports.notAvailable")}</main>;

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold text-slate-950">{t("storeOps.reports.title")}</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">{t("storeOps.reports.totalSales")}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.money(report.totalSales)}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">{t("storeOps.reports.totalRefunds")}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.money(report.totalRefunds)}</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">{t("storeOps.reports.salesCount")}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{fmt.number(report.salesCount)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("storeOps.reports.topProducts")}</h2>
          {report.topProducts.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">{t("storeOps.reports.noSales")}</p>
          ) : (
            <div className="mt-4 space-y-2">
              {report.topProducts.map((p, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-950">
                    {p.product?.name ?? t("storeOps.reports.unknownProduct")}
                  </span>
                  <span className="text-slate-600">
                    {t("storeOps.reports.soldMeta", {
                      qty: fmt.quantity(p.quantitySold),
                      revenue: fmt.number(p.revenue, { decimals: 2 }),
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">{t("storeOps.reports.lowStock")}</h2>
          {report.lowStockItems.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600">{t("storeOps.reports.nothingLow")}</p>
          ) : (
            <div className="mt-4 space-y-2">
              {report.lowStockItems.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-slate-950">{item.product.name}</span>
                  <span className="font-medium text-red-600">
                    {fmt.quantity(item.quantity)} / {fmt.quantity(item.lowStockThreshold)}
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

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";

type Sale = {
  id: number;
  totalAmount: string;
  status: string;
  createdAt: string;
  customer: { name: string } | null;
};

export default function StoreSalesPage() {
  const { t, tEnum, fmt } = useI18n();
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
      <h1 className="text-2xl font-semibold text-slate-950">{t("nav.sales")}</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("storeOps.sales.searchPlaceholder")}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-900"
        />
        {loading ? (
          <p className="mt-6 text-sm text-slate-600">{t("common.loading")}</p>
        ) : filteredSales.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">
            {search.trim()
              ? t("storeOps.sales.noMatch", { search: search.trim() })
              : t("storeOps.sales.noneYet")}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {filteredSales.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 transition hover:border-slate-300"
              >
                <Link href={`/store/sales/${sale.id}`} className="flex flex-1 items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">
                      {t("storeOps.sales.saleLabel", { id: sale.id })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {sale.customer?.name ?? t("storeOps.sales.walkIn")} · {fmt.date(sale.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-slate-950">{fmt.money(sale.totalAmount)}</p>
                    <p className="text-xs text-slate-500">{tEnum(sale.status)}</p>
                  </div>
                </Link>
                <Link
                  href={`/store/sales/${sale.id}?print=1`}
                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  {t("reports.ui.print")}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

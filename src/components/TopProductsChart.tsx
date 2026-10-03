"use client";

import { useI18n } from "@/components/LocaleProvider";
import type { StoreReport } from "@/lib/reports";

/**
 * Horizontal bar chart showing top products. Peak determines bar lengths, so
 * even a single large seller shows clearly.
 */
export function TopProductsChart({
  products,
  max = 5,
}: {
  products: StoreReport["topProducts"];
  max?: number;
}) {
  const { t, fmt } = useI18n();
  const items = products.slice(0, max);
  const peak = Math.max(1, ...items.map((p) => p.quantitySold));

  if (items.length === 0) {
    return <p className="text-sm text-slate-600">{t("storeOps.reports.noSales")}</p>;
  }

  return (
    <div className="space-y-2.5">
      {items.map((p) => {
        const pct = Math.round((p.quantitySold / peak) * 100);
        return (
          <div key={p.product?.id ?? "unknown"} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-slate-950">
                {p.product?.name ?? t("storeOps.reports.unknownProduct")}
              </span>
              <span className="shrink-0 text-xs text-slate-600">
                {t("storeOps.reports.soldMeta", {
                  qty: fmt.quantity(p.quantitySold),
                  revenue: fmt.number(p.revenue, { decimals: 2 }),
                })}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct}>
              <div
                className="h-2 rounded-full bg-slate-950"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

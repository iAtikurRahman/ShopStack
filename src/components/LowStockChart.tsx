"use client";

import { useI18n } from "@/components/LocaleProvider";
import type { StoreReport } from "@/lib/reports";

/**
 * Visualises low stock items. Bars show current vs threshold; items well below
 * threshold stand out, and all are shown in order of quantity ascending.
 */
export function LowStockChart({ items }: { items: StoreReport["lowStockItems"] }) {
  const { t, fmt } = useI18n();
  const sorted = [...items].sort((a, b) => a.quantity - b.quantity);

  if (sorted.length === 0) {
    return <p className="text-sm text-slate-600">{t("storeOps.reports.nothingLow")}</p>;
  }

  return (
    <div className="space-y-2.5">
      {sorted.map((item) => {
        const peak = Math.max(item.lowStockThreshold, item.quantity, 1);
        const qtyPct = Math.round((item.quantity / peak) * 100);
        const thPct = Math.round((item.lowStockThreshold / peak) * 100);
        return (
          <div key={`${item.warehouseId}:${item.product.id}`} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-slate-950">{item.product.name}</span>
              <span className="shrink-0 text-xs font-medium text-red-600">
                {fmt.quantity(item.quantity)} / {fmt.quantity(item.lowStockThreshold)}
              </span>
            </div>
            <div className="relative h-2 w-full rounded-full bg-slate-100">
              <div
                className="absolute left-0 top-0 h-2 rounded-full bg-red-200"
                style={{ width: `${thPct}%` }}
                aria-hidden="true"
              />
              <div
                className="absolute left-0 top-0 h-2 rounded-full bg-red-600"
                style={{ width: `${qtyPct}%` }}
                aria-hidden="true"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

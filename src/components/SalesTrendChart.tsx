"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import type { DailySales, DayReport } from "@/lib/reports";

/**
 * Daily sales as a bar chart, one clickable column per day.
 *
 * Drawn with plain elements rather than SVG: each column is a real <button>, so
 * it is focusable, works from the keyboard and announces itself to a screen
 * reader with no extra ARIA, and it needs no charting dependency. The bars share
 * one fixed-height plot area and scale against the largest value in the window,
 * so a quiet week still reads as a shape instead of a flat line.
 */
export function SalesTrendChart({ days, today }: { days: DailySales[]; today: string }) {
  const { t, fmt } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One scale for both series so their heights mean the same thing. Guarded
  // against an all-zero window, where every bar would otherwise divide by zero.
  const peak = Math.max(1, ...days.flatMap((d) => [d.totalSales, d.totalRefunds]));

  // "2026-10-14" on its own is parsed as UTC midnight and can render as the 13th
  // west of Greenwich. The time suffix pins it to local midnight, so the label
  // always shows the day the figure is actually for.
  const asLocalDate = (date: string) => new Date(`${date}T00:00:00`);

  async function selectDay(date: string) {
    // Clicking the open day closes it - the same gesture that opened it.
    if (selected === date) {
      setSelected(null);
      setDetail(null);
      return;
    }
    setSelected(date);
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<DayReport>(`/api/store/reports/day?date=${date}`);
      setDetail(data);
    } catch (err) {
      setError((err as Error).message);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: "11rem" }}>
        {days.map((day) => {
          const isSelected = selected === day.date;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => selectDay(day.date)}
              aria-pressed={isSelected}
              title={`${fmt.date(asLocalDate(day.date))} · ${fmt.money(day.totalSales)}`}
              className={`flex h-full flex-1 cursor-pointer items-end justify-center gap-px rounded-lg p-0.5 transition ${
                isSelected ? "bg-slate-100" : "hover:bg-slate-50"
              }`}
            >
              {/* Side by side, not stacked: sales and refunds are two separate
                  measures of the same day, and stacking them would read as one
                  total that they never add up to. */}
              <span
                className={`h-full w-1/2 rounded-sm ${isSelected ? "bg-red-400" : "bg-red-200"}`}
                style={{ height: `${Math.round((day.totalRefunds / peak) * 100)}%` }}
              />
              <span
                className={`h-full w-1/2 rounded-sm ${
                  isSelected ? "bg-slate-950" : day.date === today ? "bg-slate-700" : "bg-slate-400"
                }`}
                style={{ height: `${Math.round((day.totalSales / peak) * 100)}%` }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-1.5" aria-hidden="true">
        {days.map((day) => (
          <span
            key={day.date}
            className={`flex-1 text-center text-[11px] ${
              day.date === today ? "font-semibold text-slate-900" : "text-slate-500"
            }`}
          >
            {asLocalDate(day.date).getDate()}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-700" />
          {t("storeOps.reports.salesLegend")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-300" />
          {t("storeOps.reports.refundsLegend")}
        </span>
        <span className="text-slate-500">{t("storeOps.reports.clickBarHint")}</span>
      </div>

      {selected ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-950">
            {t("storeOps.reports.dayDetails", { date: fmt.date(asLocalDate(selected)) })}
          </h3>

          {loading ? (
            <p className="mt-3 text-sm text-slate-600">{t("common.loading")}</p>
          ) : error ? (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          ) : detail ? (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-600">{t("storeOps.reports.totalSales")}</p>
                  <p className="text-lg font-semibold text-slate-950">{fmt.money(detail.totalSales)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">{t("storeOps.reports.totalRefunds")}</p>
                  <p className="text-lg font-semibold text-slate-950">{fmt.money(detail.totalRefunds)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">{t("storeOps.reports.salesCount")}</p>
                  <p className="text-lg font-semibold text-slate-950">{fmt.number(detail.salesCount)}</p>
                </div>
              </div>

              {detail.sales.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">{t("storeOps.reports.noSalesOnDay")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-200">
                  {detail.sales.map((sale) => (
                    <li key={sale.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-slate-950">
                          {t("storeOps.reports.saleNumber", { id: fmt.number(sale.id) })}
                        </span>
                        <span className="ml-2 text-xs text-slate-500">
                          {[
                            fmt.dateTime(sale.soldAt),
                            sale.customerName ?? t("storeOps.reports.walkIn"),
                            t("storeOps.reports.itemCount", { count: fmt.number(sale.itemCount) }),
                            joinMethods(sale.methods),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-slate-950">
                        {fmt.money(sale.totalAmount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {detail.hasMoreSales ? (
                <p className="mt-3 text-xs text-slate-500">{t("storeOps.reports.andMoreSales")}</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Payment methods are owner-editable account names rather than a fixed
 * vocabulary, so there is no dictionary to translate them through. Joining with
 * "+" keeps a mixed-tender sale readable, and duplicates collapse because one
 * sale can list the same account twice.
 */
function joinMethods(methods: string[]): string | null {
  const unique = [...new Set(methods)];
  return unique.length > 0 ? unique.join(" + ") : null;
}
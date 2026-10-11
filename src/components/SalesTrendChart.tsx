"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { apiFetch } from "@/services/api";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { DailySales, DayReport } from "@/lib/reports";

/** The money measures plotted per day, in the order they are drawn. */
type SeriesKey =
  | "totalSales"
  | "totalPurchases"
  | "totalRefunds"
  | "totalExpenses"
  | "paymentsReceived"
  | "paymentsPaid";

const SERIES: { key: SeriesKey; label: TranslationKey; bar: string; active: string }[] = [
  { key: "totalSales", label: "storeOps.reports.salesLegend", bar: "bg-slate-400", active: "bg-slate-950" },
  { key: "totalPurchases", label: "storeOps.reports.purchasesLegend", bar: "bg-blue-300", active: "bg-blue-500" },
  { key: "totalRefunds", label: "storeOps.reports.refundsLegend", bar: "bg-red-300", active: "bg-red-500" },
  { key: "totalExpenses", label: "storeOps.reports.expensesLegend", bar: "bg-amber-300", active: "bg-amber-500" },
  { key: "paymentsReceived", label: "storeOps.reports.paymentsReceivedLegend", bar: "bg-emerald-300", active: "bg-emerald-500" },
  { key: "paymentsPaid", label: "storeOps.reports.paymentsPaidLegend", bar: "bg-violet-300", active: "bg-violet-500" },
];

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

  // One scale for every series so their heights mean the same thing. Guarded
  // against an all-zero window, where every bar would otherwise divide by zero.
  const peak = Math.max(1, ...days.flatMap((d) => SERIES.map((series) => d[series.key])));

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
              title={[
                fmt.date(asLocalDate(day.date)),
                ...SERIES.map((series) => `${t(series.label)}: ${fmt.money(day[series.key])}`),
              ].join("\n")}
              className={`flex h-full flex-1 cursor-pointer items-end justify-center gap-px rounded-lg p-0.5 transition ${
                isSelected ? "bg-slate-100" : "hover:bg-slate-50"
              }`}
            >
              {/* Side by side, not stacked: these are separate measures of the
                  same day, and stacking them would read as one total that they
                  never add up to. */}
              {SERIES.map((series) => (
                <span
                  key={series.key}
                  className={`h-full flex-1 rounded-sm ${isSelected ? series.active : series.bar}`}
                  style={{ height: `${Math.round((day[series.key] / peak) * 100)}%` }}
                />
              ))}
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
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${series.active}`} />
            {t(series.label)}
          </span>
        ))}
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
                {(
                  [
                    ["storeOps.reports.salesLegend", detail.totalSales],
                    ["storeOps.reports.purchasesLegend", detail.totalPurchases],
                    ["storeOps.reports.refundsLegend", detail.totalRefunds],
                    ["storeOps.reports.expensesLegend", detail.totalExpenses],
                    ["storeOps.reports.paymentsReceivedLegend", detail.paymentsReceived],
                    ["storeOps.reports.paymentsPaidLegend", detail.paymentsPaid],
                  ] as [TranslationKey, number][]
                ).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-slate-600">{t(label)}</p>
                    <p className="text-lg font-semibold text-slate-950">{fmt.money(value)}</p>
                  </div>
                ))}
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
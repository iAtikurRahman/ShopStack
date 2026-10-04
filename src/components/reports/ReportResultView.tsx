"use client";

import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { Formatters } from "@/lib/i18n/format";
import type { ReportBlockItem, ReportColumn, ReportResult, ReportRow } from "@/lib/reports/types";

/**
 * One renderer for a finished report, used by the screen and by the print view.
 *
 * The two must not be able to drift - a printed copy that disagrees with the
 * screen is worse than either being wrong on its own, so both go through here.
 * (The PDF download has its own builder, because pdfmake runs on the server.)
 *
 * Every label arrives as a dictionary *key* rather than as text, which is what
 * lets one report definition serve both locales; `tx` is the single place that
 * resolves those keys, and it is why this file never contains a hard-coded word
 * a user would read.
 */

function numeric(column: ReportColumn): boolean {
  return column.type === "money" || column.type === "number" || column.type === "quantity" || column.type === "percent";
}

function figure(value: number | string, type: ReportColumn["type"], fmt: Formatters): string {
  // A `text` metric carries a word (the busiest hour of the day, say), so it is
  // printed as it is rather than pushed through a number formatter.
  if (type === "text") return String(value);
  if (type === "money") return fmt.money(Number(value));
  if (type === "percent") return fmt.percent(Number(value));
  if (type === "quantity") return fmt.quantity(Number(value));
  return fmt.number(Number(value));
}

function Cell({ row, column, fmt }: { row: ReportRow; column: ReportColumn; fmt: Formatters }) {
  const { t } = useI18n();
  const tx = (key: string) => t(key as TranslationKey);
  const value = row[column.key];
  if (value === null || value === undefined) return <td className="px-3 py-2 text-slate-400">—</td>;
  if (typeof value === "boolean") {
    return (
      <td className="px-3 py-2">
        <span
          className={
            value
              ? "inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
              : "inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
          }
        >
          {value ? t("common.yes") : t("common.no")}
        </span>
      </td>
    );
  }
  // `badge` and `key` cells carry a dictionary key; a raw enum or a name that is
  // not a key comes back out of `t` unchanged, which is why one lookup serves
  // both.
  const text =
    column.type === "money" || column.type === "quantity" || column.type === "percent" || column.type === "number"
      ? figure(value, column.type, fmt)
      : column.type === "date"
        ? fmt.date(String(value))
        : column.type === "datetime"
          ? fmt.dateTime(String(value))
          : column.type === "badge" || column.type === "key"
            ? tx(String(value))
            : String(value);
  const badge = column.type === "badge";
  return (
    <td className={`px-3 py-2 ${numeric(column) ? "text-right tabular-nums" : ""}`}>
      {badge ? (
        <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{text}</span>
      ) : (
        text
      )}
    </td>
  );
}

/** The totals line, over exactly the columns the report marked summable. */
function Totals({ columns, rows }: { columns: ReportColumn[]; rows: ReportRow[] }) {
  const { t, fmt } = useI18n();
  const sums = columns.some((column) => column.sum && column.type !== "percent");
  if (!sums) return null;
  return (
    <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-900">
      <tr>
        {columns.map((column, index) => {
          const summable = column.sum && column.type !== "percent";
          if (index === 0) return <th key={column.key} className="px-3 py-2 text-left font-semibold">{t("common.total")}</th>;
          if (!summable) return <th key={column.key} className="px-3 py-2" />;
          const total = rows.reduce((sum, row) => {
            const value = row[column.key];
            return typeof value === "number" ? sum + value : sum;
          }, 0);
          return (
            <th key={column.key} className="px-3 py-2 text-right tabular-nums">
              {figure(total, column.type, fmt)}
            </th>
          );
        })}
      </tr>
    </tfoot>
  );
}

function Tile({ item }: { item: ReportBlockItem }) {
  const { t, fmt } = useI18n();
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{t(item.label as TranslationKey)}</p>
      <p className={`mt-1 text-xl font-semibold ${item.negative ? "text-rose-700" : "text-slate-950"}`}>
        {figure(item.value, item.type, fmt)}
      </p>
      {item.previous !== undefined || item.change !== undefined ? (
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="text-slate-500">
            {t("reports.ui.previousWindowShort")}:{" "}
            {item.previous === undefined ? "—" : figure(item.previous, item.type, fmt)}
          </span>
          {item.change !== undefined ? (
            <span
              className={
                item.change > 0 ? "text-emerald-700" : item.change < 0 ? "text-rose-700" : "text-slate-500"
              }
            >
              {item.change > 0 ? "+" : ""}
              {fmt.number(item.change)}
              {item.previous ? ` (${fmt.percent(item.changeRate ?? 0)})` : ""}
            </span>
          ) : null}
        </p>
      ) : null}
      {item.note ? <p className="mt-1 text-xs text-slate-500">{t(item.note as TranslationKey)}</p> : null}
    </div>
  );
}

/**
 * `scrollable` is for the screen (the table scrolls inside a fixed height) and
 * `summary` is for it too: on paper the headline figures are noise in front of
 * the table, which is the part anyone reads, so the print view leaves them out.
 */
export function ReportResultView({
  report,
  scrollable = true,
  summary = true,
}: {
  report: ReportResult;
  scrollable?: boolean;
  summary?: boolean;
}) {
  const { t, fmt } = useI18n();
  const tx = (key: string) => t(key as TranslationKey);

  const groups: { title: string; items: ReportBlockItem[] }[] = [];
  for (const block of report.blocks ?? []) {
    const existing = groups.find((group) => group.title === block.title);
    if (existing) existing.items.push(...block.items);
    else groups.push({ title: block.title, items: [...block.items] });
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{tx(group.title)}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => (
              <Tile key={item.key} item={item} />
            ))}
          </div>
        </section>
      ))}

      {summary && report.metrics.length > 0 ? (
        <section className="print-hide">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{t("reports.ui.summary")}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {report.metrics.map((metric) => (
              <div key={metric.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">{tx(metric.label)}</p>
                <p className={`mt-1 text-xl font-semibold ${metric.negative ? "text-rose-700" : "text-slate-950"}`}>
                  {figure(metric.value, metric.type, fmt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {report.columns.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {/* The screen scrolls inside a fixed height; the print view must not,
           * or the printer would only ever get the first screenful of rows. */}
          <div className={scrollable ? "max-h-[34rem] overflow-auto" : undefined}>
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
                <tr>
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={`px-3 py-2 font-medium ${numeric(column) ? "text-right" : "text-left"}`}
                    >
                      {tx(column.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-slate-100 align-top">
                    {report.columns.map((column) => (
                      <Cell key={column.key} row={row} column={column} fmt={fmt} />
                    ))}
                  </tr>
                ))}
              </tbody>
              <Totals columns={report.columns} rows={report.rows} />
            </table>
          </div>
        </section>
      ) : null}

      {report.rows.length === 0 && report.columns.length > 0 ? (
        <p className="-mt-2 text-sm text-slate-600">{t("reports.ui.noRows")}</p>
      ) : null}

      {report.truncated ? (
        <p className="text-xs text-amber-700">
          {t("reports.ui.truncatedUi", { shown: report.rows.length, total: report.totalRows ?? 0 })}
        </p>
      ) : null}

      {report.notes && report.notes.length > 0 ? (
        <section className="print-hide rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{t("reports.ui.notes")}</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            {report.notes.map((note) => (
              <li key={note}>{tx(note)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
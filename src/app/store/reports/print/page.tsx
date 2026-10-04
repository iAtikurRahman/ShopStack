"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportResultView } from "@/components/reports/ReportResultView";
import { useI18n } from "@/components/LocaleProvider";
import { localizeServerMessage } from "@/lib/i18n/active-dictionary";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { REPORT_PERIOD_PRESETS, type ReportPeriodPreset, type ReportResult } from "@/lib/reports/types";

/**
 * The print view.
 *
 * A separate route rather than a stylesheet on the report screen, because a
 * printed report has to be the report on its own - no picker, no buttons, no
 * half-scrolled table. It takes the same key and period from the URL, fetches
 * the same JSON, and renders through the same component as the screen, so what
 * comes out of the printer is what was on the display.
 *
 * (The PDF download is a third rendering of the same data, built server-side by
 * pdfmake. Three renderers is only safe because all three read one contract.)
 */

function PrintView() {
  const { t, fmt } = useI18n();
  const params = useSearchParams();
  const [report, setReport] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = params.get("key") ?? "";
  const presetParam = params.get("preset") ?? "last30days";
  const preset = (REPORT_PERIOD_PRESETS as readonly string[]).includes(presetParam)
    ? (presetParam as ReportPeriodPreset)
    : "last30days";

  useEffect(() => {
    if (!key) return;
    const query = new URLSearchParams({ preset });
    const from = params.get("from");
    const to = params.get("to");
    if (preset === "custom") {
      if (from) query.set("from", from);
      if (to) query.set("to", to);
    }
    let cancelled = false;
    fetch(`/api/store/reports/${key}?${query.toString()}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(localizeServerMessage(data?.message ?? "Request failed"));
        return data as ReportResult;
      })
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((fetchError: Error) => {
        if (!cancelled) setError(fetchError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [key, preset, params]);

  // Open the print dialog once the figures are on screen; the button is there
  // for the second attempt if the browser blocked the first.
  useEffect(() => {
    if (!report) return;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [report]);

  if (error) return <main className="p-8 text-sm text-red-600">{error}</main>;
  if (!report) return <main className="p-8" aria-hidden />;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <style>{`@media print { .no-print { display: none } body { background: #fff } }`}</style>
      <div className="no-print mb-4 flex justify-end">
        <button type="button" onClick={() => window.print()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">
          {t("reports.ui.print")}
        </button>
      </div>
      <header className="mb-6 border-b border-slate-200 pb-3">
        <h1 className="text-xl font-semibold text-slate-950">{t(report.title as TranslationKey)}</h1>
        <p className="text-xs text-slate-500">
          {t("reports.ui.range", { from: fmt.date(report.period.from), to: fmt.date(report.period.to) })} ·{" "}
          {t("reports.ui.generatedAt", { at: fmt.dateTime(new Date().toISOString()) })}
        </p>
      </header>
      <ReportResultView report={report} scrollable={false} />
    </main>
  );
}

export default function ReportPrintPage() {
  return (
    <Suspense fallback={<main className="p-8" aria-hidden />}>
      <PrintView />
    </Suspense>
  );
}
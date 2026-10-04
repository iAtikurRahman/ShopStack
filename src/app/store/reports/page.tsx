"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportResultView } from "@/components/reports/ReportResultView";
import { ReportLetterheadView } from "@/components/reports/ReportLetterheadView";
import { letterheadLines } from "@/lib/reports/letterhead";
import { useI18n } from "@/components/LocaleProvider";
import { localizeServerMessage } from "@/lib/i18n/active-dictionary";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { ReportCatalogEntry, ReportCatalogResponse, ReportResult } from "@/lib/reports/types";
import { REPORT_PERIOD_PRESETS, type ReportPeriodPreset } from "@/lib/reports/types";
import { PRESET_MAX_DAYS } from "@/lib/reports/period";

/**
 * The reports screen: a catalog on the left, one report on the right.
 *
 * One page draws all ~80 reports, because they all answer in the same shape -
 * the screen knows nothing about sales or stock, only about columns, rows and
 * headline figures. Adding a report is then a change to one catalog entry, and
 * this file never has to learn the report's name.
 *
 * The selection lives in the URL (`?key=â€¦&preset=â€¦`) so a report can be linked,
 * bookmarked and printed, and so a refresh keeps the same figures on screen.
 */

type Scope = { key: string; preset: ReportPeriodPreset; from?: string; to?: string };

function scopeFromParams(params: URLSearchParams | null): Scope {
  const preset = params?.get("preset");
  const key = params?.get("key") ?? "";
  return {
    key,
    preset: (REPORT_PERIOD_PRESETS as readonly string[]).includes(preset ?? "")
      ? (preset as ReportPeriodPreset)
      : "last30days",
    from: params?.get("from") ?? undefined,
    to: params?.get("to") ?? undefined,
  };
}

/** The query string both the JSON and the PDF route read. */
function reportQuery(scope: Scope): string {
  const query = new URLSearchParams({ preset: scope.preset });
  if (scope.preset === "custom") {
    if (scope.from) query.set("from", scope.from);
    if (scope.to) query.set("to", scope.to);
  }
  return query.toString();
}

/** The name the server gave the download, so the browser keeps its wording. */
function filenameFrom(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return match ? match[1] : fallback;
}

/** The days a custom range covers, inclusive of both ends. Null while the dates
 *  are not both filled in, which is not an error - the range is simply not set. */
function customSpanDays(from: string, to: string): number | null {
  if (!from || !to) return null;
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

function ReportsWorkspace() {
  const { t, fmt } = useI18n();
  /** Report and catalog labels travel as dictionary keys, so this is the one
   *  place that resolves them; every user-visible word comes from a dictionary. */
  const label = (key: string) => t(key as TranslationKey);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [catalog, setCatalog] = useState<ReportCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /** The last answer, and the error beside it, each tagged with the request it
   *  belongs to. Whether a report is loading is then a question about the tags
   *  rather than a third piece of state to keep in step. */
  const [loaded, setLoaded] = useState<{ requestKey: string; report: ReportResult } | null>(null);
  const [failure, setFailure] = useState<{ requestKey: string; message: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  /** Bumped by the Refresh button: re-selecting the same URL would not change
   *  anything, so the request would never go out again. */
  const [reload, setReload] = useState(0);

  const scope = useMemo(() => scopeFromParams(searchParams), [searchParams]);
  const query = useMemo(() => reportQuery(scope), [scope]);

  /** The selected report's own ceiling, or the global one when it has none. */
  const maxRangeDays = useMemo(() => {
    const entries = catalog?.families.flatMap((group) => group.reports) ?? [];
    const selected = entries.find((entry) => entry.key === scope.key);
    return selected?.maxRangeDays ?? catalog?.limits.maxRangeDays ?? null;
  }, [catalog, scope.key]);

  /** Presets this report can answer. Offering "This year" to a report that
   *  buckets sales in memory would only hand back a refusal. */
  const presets = useMemo(() => {
    const all = catalog?.presets ?? [];
    return maxRangeDays === null ? all : all.filter((preset) => preset === "custom" || PRESET_MAX_DAYS[preset] <= maxRangeDays);
  }, [catalog, maxRangeDays]);

  /** True when the chosen window is one this report will refuse. */
  const windowTooLong = useMemo(() => {
    if (!scope.key || maxRangeDays === null) return false;
    const span =
      scope.preset === "custom"
        ? customSpanDays(scope.from ?? "", scope.to ?? "")
        : PRESET_MAX_DAYS[scope.preset];
    return span !== null && span > maxRangeDays;
  }, [scope, maxRangeDays]);

  /** The two strings the paper's letterhead prints, worked out once. */
  const letterheadText = useMemo(() => {
    if (!catalog) return null;
    return letterheadLines(catalog.letterhead, { allStores: t("reports.ui.allStores") });
  }, [catalog, t]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/store/reports/catalog")
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(localizeServerMessage(data?.message ?? "Request failed"));
        return data as ReportCatalogResponse;
      })
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((error: Error) => {
        if (!cancelled) setCatalogError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Identifies the request the figures on screen belong to. Anything that
   *  changes what would be asked for - the report, the window, a refresh - makes
   *  a new key, so a stale answer can never be shown as if it were current. */
  const requestKey = `${reload}:${scope.key}:${query}`;

  /** Stale figures must never sit under a window the report refuses, nor under
   *  a question the user has since changed. */
  const report = !windowTooLong && loaded?.requestKey === requestKey ? loaded.report : null;
  const reportError = failure?.requestKey === requestKey ? failure.message : null;
  const loadingReport = scope.key !== "" && !windowTooLong && !report && reportError === null;

  /** The window the server actually resolved. A custom range the server had to
   *  clamp is echoed back in the result, so the date boxes fall back to it: the
   *  boxes always show the range the figures on screen were built from. */
  const serverRange = report?.period.preset === "custom" ? report.period : null;
  const fromValue = from || serverRange?.from || "";
  const toValue = to || serverRange?.to || "";

  useEffect(() => {
    // A window this report cannot answer is caught above, in the picker, so the
    // request is never even sent.
    if (!scope.key || windowTooLong) return;
    let cancelled = false;
    fetch(`/api/store/reports/${scope.key}?${query}`)
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setFailure({ requestKey, message: localizeServerMessage(data?.message ?? "Request failed") });
          return;
        }
        setFailure(null);
        setLoaded({ requestKey, report: data as ReportResult });
      })
      .catch((error: Error) => {
        if (!cancelled) setFailure({ requestKey, message: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, scope.key, query, windowTooLong]);

  function select(next: Partial<Scope>) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = { ...scope, ...next };
    if (merged.key) params.set("key", merged.key);
    else params.delete("key");
    params.set("preset", merged.preset);
    if (merged.preset === "custom") {
      if (merged.from) params.set("from", merged.from);
      if (merged.to) params.set("to", merged.to);
    } else {
      params.delete("from");
      params.delete("to");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function download() {
    setDownloading(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/store/reports/${scope.key}/pdf?${query}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(localizeServerMessage(data?.message ?? "Request failed"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFrom(response, `${scope.key}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFailure({ requestKey, message: (error as Error).message });
    } finally {
      setDownloading(false);
    }
  }

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const tx = (key: string) => t(key as TranslationKey);
    return (catalog?.families ?? [])
      .map(({ family, reports }) => ({
        family,
        reports: reports.filter(
          (entry) =>
            needle === "" ||
            entry.key.toLowerCase().includes(needle) ||
            tx(entry.title).toLowerCase().includes(needle) ||
            tx(entry.description).toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.reports.length > 0);
  }, [catalog, search, t]);

  if (catalogError) {
    return <main className="p-8 text-sm text-red-600">{catalogError}</main>;
  }
  if (!catalog) {
    return <main className="p-8 text-sm text-slate-600">{t("common.loading")}</main>;
  }

  return (
    <main className="mx-auto max-w-[100rem] p-6 print-root">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-slate-950">{t("reports.ui.title")}</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* The catalog is far longer than the screen, so the option list gets its
         *  own scrollbar and the page itself does not scroll past it: the search
         *  box stays put, the reports move. On a wide window the column is also
         *  pinned, so the report on the right can be read to its end while the
         *  list stays beside it. */}
        <aside className="print-hide flex max-h-[70vh] flex-col space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)]">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("reports.ui.searchPlaceholder")}
            aria-label={t("reports.ui.searchPlaceholder")}
            className="w-full shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <nav className="space-y-4">
              {groups.length === 0 ? (
                <p className="text-sm text-slate-600">{t("reports.ui.noMatch", { search: search.trim() })}</p>
              ) : null}
              {groups.map((group) => (
                <section key={group.family}>
                  <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t(`reports.family.${group.family}`)}
                  </h2>
                  <ul className="mt-1 space-y-0.5">
                    {group.reports.map((entry: ReportCatalogEntry) => {
                      const active = entry.key === scope.key;
                      return (
                        <li key={entry.key}>
                          <button
                            type="button"
                            onClick={() => select({ key: entry.key })}
                            aria-current={active ? "true" : undefined}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                              active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            <span className="block font-medium">{label(entry.title)}</span>
                            <span className={`block text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                              {label(entry.description)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </nav>

            <section className="mt-4">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("reports.ui.unavailableTitle")}
              </h2>
              <p className="px-1 pt-1 text-xs text-slate-500">{t("reports.ui.unavailableIntro")}</p>
              <ul className="mt-2 space-y-1.5">
                {catalog.unavailable.map((entry) => (
                  <li key={entry.key} className="rounded-lg border border-dashed border-slate-300 px-3 py-2">
                    <p className="text-sm text-slate-600">{label(entry.title)}</p>
                    <p className="text-xs text-slate-500">
                      {t("reports.ui.whyNot")} {label(entry.reason)}
                    </p>
                  </li>
                ))}
              </ul>
          </section>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="print-hide flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="text-xs font-medium text-slate-600">
              <span className="block pb-1">{t("reports.ui.periodLabel")}</span>
              <select
                value={scope.preset}
                onChange={(event) => select({ preset: event.target.value as ReportPeriodPreset })}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              >
                {presets
                  .filter((preset) => preset !== "custom")
                  .map((preset) => (
                    <option key={preset} value={preset}>
                      {t(`reports.preset.${preset}`)}
                    </option>
                  ))}
                <option value="custom">{t("reports.ui.customRange")}</option>
              </select>
            </label>

            {scope.preset === "custom" ? (
              <>
                <label className="text-xs font-medium text-slate-600">
                  <span className="block pb-1">{t("reports.ui.from")}</span>
                  <input
                    type="date"
                    value={fromValue}
                    onChange={(event) => setFrom(event.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  <span className="block pb-1">{t("reports.ui.to")}</span>
                  <input
                    type="date"
                    value={toValue}
                    onChange={(event) => setTo(event.target.value)}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => select({ preset: "custom", from: fromValue, to: toValue })}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
                >
                  {t("reports.ui.apply")}
                </button>
              </>
            ) : null}

            <div className="ml-auto flex items-end gap-2">
              <button
                type="button"
                onClick={() => setReload((count) => count + 1)}
                disabled={loadingReport || !scope.key}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-40"
              >
                {t("reports.ui.refresh")}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                disabled={!report}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-40"
              >
                {t("reports.ui.print")}
              </button>
              <button
                type="button"
                onClick={download}
                disabled={downloading || !report}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                {downloading ? t("reports.ui.downloading") : t("reports.ui.download")}
              </button>
            </div>
          </div>

          {!scope.key ? (
            <p className="text-sm text-slate-600">{t("reports.ui.pickReport")}</p>
          ) : null}
          {windowTooLong ? (
            <p className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              {t("reports.ui.windowTooLong", { days: maxRangeDays ?? 0 })}
            </p>
          ) : null}
          {loadingReport ? <p className="text-sm text-slate-600">{t("reports.ui.loadingReport")}</p> : null}
          {reportError ? <p className="text-sm text-red-600">{reportError}</p> : null}

          {report ? (
            <>
              <div className="print-hide">
                <h2 className="text-lg font-semibold text-slate-950">
                  {label(report.title)}
                </h2>
                <p className="text-xs text-slate-500">
                  {t("reports.ui.range", {
                    from: fmt.date(report.period.from),
                    to: fmt.date(report.period.to),
                  })}
                </p>
              </div>
              {letterheadText ? (
                <div className="hidden print:block">
                  <ReportLetterheadView
                    logoUrl={catalog.letterhead.imageUrl}
                    logoAlt={letterheadText.heading}
                    heading={letterheadText.heading}
                    contact={letterheadText.contact}
                    company={letterheadText.company}
                    storeName={letterheadText.store}
                    title={label(report.title)}
                    periodLine={t("reports.ui.range", {
                      from: fmt.date(report.period.from),
                      to: fmt.date(report.period.to),
                    })}
                  />
                </div>
              ) : null}
              <ReportResultView report={report} />
              <div className="hidden print:block text-right text-xs text-slate-500">
                <p>{t("reports.ui.generatedAt", { at: fmt.dateTime(new Date().toISOString()) })}</p>
                <p>{t("reports.ui.printedBy", { name: catalog.viewer.name })}</p>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default function StoreReportsPage() {
  // The workspace reads the URL, and a component that reads searchParams has to
  // sit inside a Suspense boundary or the route cannot be prerendered.
  return (
    <Suspense fallback={<main className="mx-auto max-w-[100rem] animate-pulse p-6" aria-hidden />}>
      <ReportsWorkspace />
    </Suspense>
  );
}
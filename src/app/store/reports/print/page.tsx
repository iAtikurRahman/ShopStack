export const dynamic = "force-dynamic";

import { requireTenantSession } from "@/lib/session";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";
import { createFormatters } from "@/lib/i18n/format";
import { runReport } from "@/lib/reports/run";
import { reportLetterhead, letterheadLines } from "@/lib/reports/letterhead";
import { REPORT_PERIOD_PRESETS } from "@/lib/reports/types";
import type { ReportPeriodPreset } from "@/lib/reports/types";
import { ReportResultView } from "@/components/reports/ReportResultView";
import { ReportLetterheadView } from "@/components/reports/ReportLetterheadView";
import { PrintButton } from "@/components/reports/PrintButton";
import { ApiError } from "@/lib/session";

/**
 * The print view: one report as a document, on its own.
 *
 * Server-rendered rather than fetched from the API after mount, because a
 * printed report should arrive whole - the letterhead, the figures and the
 * table in one document, with no flash of an empty page in front of the print
 * dialog - and because building it here can read the session's store directly,
 * which is where the letterhead comes from.
 *
 * It asks unReport for the same answer the screen and the PDF get, so the
 * three cannot disagree. The app's own navigation never reaches the paper: the
 * print stylesheet in globals.css drops the chrome, and what is left is the
 * letterhead, the report and its notes.
 */
export default async function ReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const key = typeof params.key === "string" ? params.key : "";
  const presetParam = typeof params.preset === "string" ? params.preset : "last30days";
  const preset = (REPORT_PERIOD_PRESETS as readonly string[]).includes(presetParam)
    ? (presetParam as ReportPeriodPreset)
    : "last30days";
  const from = typeof params.from === "string" ? params.from : undefined;
  const to = typeof params.to === "string" ? params.to : undefined;

  const locale = await readLocaleCookie();
  const dictionary = getDictionary(locale);
  const t = (key_: string, vars?: Record<string, string | number>) =>
    translate(dictionary, key_ as Parameters<typeof translate>[1], vars);
  const fmt = createFormatters(locale);

  let report;
  let letterhead;
  let printedBy: string;
  try {
    const { session, db } = await requireTenantSession({
      roles: ["company_admin", "store_manager"],
      permission: "can_view_reports",
    });
    [report, letterhead] = await Promise.all([
      runReport(db, session, key, { preset, from, to }),
      reportLetterhead(db, session),
    ]);
    printedBy = session.name;
  } catch (error) {
    if (error instanceof ApiError) {
      return (
        <main className="mx-auto max-w-5xl p-6 text-sm text-slate-600">
          {t("reports.ui.pickReport")}
        </main>
      );
    }
    throw error;
  }

  const { heading, contact } = letterheadLines(letterhead, {
    allStores: t("reports.ui.allStores"),
  });

  return (
    <main className="mx-auto max-w-5xl bg-white p-6 print-root">
      <PrintButton label={t("reports.ui.print")} />
          <ReportLetterheadView
            logoUrl={letterhead.imageUrl}
            logoAlt={heading}
            heading={heading}
            contact={contact}
            company={letterhead.companyName}
            storeName={letterhead.name}
            title={t(report.title)}
            periodLine={t("reports.ui.range", {
              from: fmt.date(report.period.from),
              to: fmt.date(report.period.to),
            })}
          />
      <ReportResultView report={report} scrollable={false} summary={false} />
          <div className="mt-4 text-right text-xs text-slate-500">
            <p>{t("reports.ui.generatedAt", { at: fmt.dateTime(new Date().toISOString()) })}</p>
            <p>{t("reports.ui.printedBy", { name: printedBy })}</p>
          </div>
    </main>
  );
}
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { catalogByFamily, REPORT_COUNT, UNAVAILABLE_REPORTS } from "@/lib/reports/catalog";
import { MAX_RANGE_DAYS, MAX_ROWS } from "@/lib/reports/period";
import { REPORT_PERIOD_PRESETS, type ReportCatalogResponse } from "@/lib/reports/types";

/**
 * The catalog, for the picker.
 *
 * Definitions carry `build` functions, which are not serialisable, so this sends
 * the metadata only: key, family, title and description dictionary keys. That is
 * all the screen needs to render the list, and it keeps the list a single cheap
 * fetch the page makes once instead of a request per report.
 */
export const GET = withAuth(async (_request, { session }) => {
  const payload: ReportCatalogResponse = {
    presets: [...REPORT_PERIOD_PRESETS],
    families: catalogByFamily().map(({ family, reports }) => ({
      family,
      reports: reports.map((report) => ({
        key: report.key,
        family: report.family,
        title: report.title,
        description: report.description,
        maxRangeDays: report.maxRangeDays,
      })),
    })),
    unavailable: UNAVAILABLE_REPORTS,
    count: REPORT_COUNT,
    limits: { maxRangeDays: MAX_RANGE_DAYS, maxRows: MAX_ROWS },
    // The screen says "your store" or "all stores" on every report, so it needs
    // to know which it is looking at before the first report comes back.
    scope: { storeId: session.storeId, allStores: session.storeId === null },
  };
  return NextResponse.json(payload);
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_view_reports" });
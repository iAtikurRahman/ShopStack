import Link from "next/link";
import { requireTenantSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getStoreReport, getDailySales, todayKey } from "@/lib/reports";
import { SalesTrendChart } from "@/components/SalesTrendChart";
import { TopProductsChart } from "@/components/TopProductsChart";
import { LowStockChart } from "@/components/LowStockChart";
import { MiniBarChart } from "@/components/MiniBarChart";
import { getDictionary, translate, type TranslationKey } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";
import { createFormatters } from "@/lib/i18n/format";

/** Days of history the trend chart shows. */
const TREND_DAYS = 14;

export default async function StoreDashboardPage() {
  const { session, db } = await requireTenantSession({ roles: ["company_admin", "store_manager", "store_user"] });
  const store = session.storeId
    ? await db.store.findUnique({ where: { id: session.storeId } })
    : null;

  const locale = await readLocaleCookie();
  const dictionary = getDictionary(locale);
  const fmt = createFormatters(locale);
  const t = (key: TranslationKey, vars?: Record<string, string | number>) =>
    translate(dictionary, key, vars);

  const canViewReports = await hasPermission(db, session, "can_view_reports");

  const today = todayKey();
  const [daily, allTime] = canViewReports
    ? await Promise.all([getDailySales(db, session, TREND_DAYS), getStoreReport(db, session)])
    : [null, null];

  const todayFigures = daily ? daily[daily.length - 1] : null;
  const allTimePeakSales = allTime ? Math.max(allTime.totalSales, allTime.totalRefunds, 1) : 1;

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">
          {t("storeOps.dashboard.welcome", { name: session.name })}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {store
            ? t("storeOps.dashboard.workingFrom", { store: store.name })
            : t("storeOps.dashboard.companyWideAccess")}
        </p>
      </div>

      {allTime && todayFigures ? (
        <>
          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("storeOps.dashboard.todayTitle")}
              </h2>
              <p className="text-sm text-slate-600">{fmt.date(new Date(`${today}T00:00:00`))}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <MiniBarChart
                value={todayFigures.totalSales}
                peak={Math.max(1, ...daily!.map((d) => d.totalSales), todayFigures.totalSales)}
                label={t("storeOps.dashboard.todaySales")}
                sublabel={fmt.money(todayFigures.totalSales)}
                tone="slate"
              />
              <MiniBarChart
                value={todayFigures.totalRefunds}
                peak={Math.max(1, ...daily!.map((d) => d.totalRefunds), todayFigures.totalRefunds)}
                label={t("storeOps.dashboard.todayRefunds")}
                sublabel={fmt.money(todayFigures.totalRefunds)}
                tone="red"
              />
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-600">{t("storeOps.reports.salesCount")}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">
                  {fmt.number(todayFigures.salesCount)}
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-950">
                {t("storeOps.reports.trendTitle", { days: TREND_DAYS })}
              </h3>
              <div className="mt-4">
                <SalesTrendChart days={daily!} today={today} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-950">
              {t("storeOps.dashboard.allReportsTitle")}
            </h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <MiniBarChart
                value={allTime.totalSales}
                peak={allTimePeakSales}
                label={t("storeOps.reports.totalSales")}
                sublabel={fmt.money(allTime.totalSales)}
                tone="slate"
              />
              <MiniBarChart
                value={allTime.totalRefunds}
                peak={allTimePeakSales}
                label={t("storeOps.reports.totalRefunds")}
                sublabel={fmt.money(allTime.totalRefunds)}
                tone="red"
              />
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-600">{t("storeOps.reports.salesCount")}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">
                  {fmt.number(allTime.salesCount)}
                </p>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-950">
                  {t("storeOps.reports.topProducts")}
                </h3>
                <div className="mt-4">
                  <TopProductsChart products={allTime.topProducts} />
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-950">
                  {t("storeOps.reports.lowStock")}
                </h3>
                <div className="mt-4">
                  <LowStockChart items={allTime.lowStockItems} />
                </div>
              </div>
            </div>

            <Link
              href="/store/reports"
              className="inline-block text-sm font-medium text-slate-700 underline hover:text-slate-950"
            >
              {t("storeOps.dashboard.fullReports")}
            </Link>
          </section>
        </>
      ) : (
        <p className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          {t("storeOps.dashboard.reportsHidden")}
        </p>
      )}
    </main>
  );
}
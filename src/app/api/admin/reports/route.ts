import { NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { withAuth } from "@/lib/api-guard";

// Reads only from the CompanyMetricsSnapshot rollup table - never fans out
// live to every tenant database on a dashboard page load. See
// POST /api/admin/reports/refresh for how the rollup gets populated.
export const GET = withAuth(async () => {
  const [companies, companyCount, activeCount] = await Promise.all([
    centralDb.company.findMany({
      include: { metricsSnapshot: true },
      orderBy: { createdAt: "desc" },
    }),
    centralDb.company.count(),
    centralDb.company.count({ where: { status: "active" } }),
  ]);

  const totals = companies.reduce(
    (acc, company) => {
      const snap = company.metricsSnapshot;
      if (!snap) return acc;
      return {
        totalSales: acc.totalSales + Number(snap.totalSales),
        totalRefunds: acc.totalRefunds + Number(snap.totalRefunds),
        salesCount: acc.salesCount + snap.salesCount,
      };
    },
    { totalSales: 0, totalRefunds: 0, salesCount: 0 }
  );

  return NextResponse.json({
    companyCount,
    activeCount,
    totals,
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      metrics: c.metricsSnapshot,
    })),
  });
}, { scope: "project_admin" });

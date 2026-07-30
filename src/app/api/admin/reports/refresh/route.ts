import { NextResponse } from "next/server";
import { centralDb } from "@/lib/central-db";
import { getTenantClient } from "@/lib/tenant-db";
import { withAuth } from "@/lib/api-guard";

// Stand-in for a scheduled job in this MVP: recomputes each active
// company's headline metrics from its own tenant database and upserts
// them into the central CompanyMetricsSnapshot rollup. A production
// deployment would call this from a cron trigger instead of a button.
export const POST = withAuth(async () => {
  const companies = await centralDb.company.findMany({ where: { status: "active" } });

  const results: { companyId: number; ok: boolean; error?: string }[] = [];

  for (const company of companies) {
    try {
      const tenantDb = await getTenantClient(company.id);
      const [salesAgg, refundsAgg, storeCount, userCount] = await Promise.all([
        tenantDb.sale.aggregate({ _sum: { totalAmount: true }, _count: true }),
        tenantDb.return.aggregate({ _sum: { refundAmount: true } }),
        tenantDb.store.count(),
        tenantDb.user.count(),
      ]);

      await centralDb.companyMetricsSnapshot.upsert({
        where: { companyId: company.id },
        update: {
          totalSales: salesAgg._sum.totalAmount ?? 0,
          totalRefunds: refundsAgg._sum.refundAmount ?? 0,
          salesCount: salesAgg._count,
          storeCount,
          userCount,
          refreshedAt: new Date(),
        },
        create: {
          companyId: company.id,
          totalSales: salesAgg._sum.totalAmount ?? 0,
          totalRefunds: refundsAgg._sum.refundAmount ?? 0,
          salesCount: salesAgg._count,
          storeCount,
          userCount,
        },
      });
      results.push({ companyId: company.id, ok: true });
    } catch (err) {
      results.push({ companyId: company.id, ok: false, error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  return NextResponse.json({ refreshed: results.filter((r) => r.ok).length, results });
}, { scope: "project_admin" });

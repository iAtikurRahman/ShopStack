import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { db }) => {
  const [salesAgg, refundsAgg, byStore, byCashier, topProducts, allStock, stores, users] = await Promise.all([
    db.sale.aggregate({ _sum: { totalAmount: true }, _count: true }),
    db.return.aggregate({ _sum: { refundAmount: true } }),
    db.sale.groupBy({ by: ["storeId"], _sum: { totalAmount: true }, _count: true }),
    db.sale.groupBy({ by: ["cashierId"], _sum: { totalAmount: true }, _count: true }, ),
    db.saleItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    db.warehouseStock.findMany({ select: { quantity: true, lowStockThreshold: true } }),
    db.store.findMany({ select: { id: true, name: true } }),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);

  const storeMap = new Map(stores.map((s) => [s.id, s.name]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  const productIds = topProducts.map((p) => p.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lowStockCount = allStock.filter((s) => s.quantity <= s.lowStockThreshold).length;

  return NextResponse.json({
    totalSales: salesAgg._sum.totalAmount ?? 0,
    totalRefunds: refundsAgg._sum.refundAmount ?? 0,
    salesCount: salesAgg._count,
    lowStockCount,
    byStore: byStore.map((row) => ({
      storeId: row.storeId,
      storeName: storeMap.get(row.storeId) ?? `Store ${row.storeId}`,
      totalSales: row._sum.totalAmount ?? 0,
      salesCount: row._count,
    })),
    staffPerformance: byCashier.map((row) => ({
      cashierId: row.cashierId,
      cashierName: userMap.get(row.cashierId) ?? `User ${row.cashierId}`,
      totalSales: row._sum.totalAmount ?? 0,
      salesCount: row._count,
    })),
    topProducts: topProducts.map((p) => ({
      product: productMap.get(p.productId) ?? null,
      quantitySold: p._sum.quantity ?? 0,
      revenue: p._sum.lineTotal ?? 0,
    })),
  });
}, { scope: "tenant", roles: ["company_admin"] });

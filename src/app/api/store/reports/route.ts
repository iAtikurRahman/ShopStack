import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";

export const GET = withAuth(async (_request, { session, db }) => {
  const storeId = session.storeId ?? -1;

  const [salesAgg, refundsAgg, topProducts, warehouses] = await Promise.all([
    db.sale.aggregate({ where: { storeId }, _sum: { totalAmount: true }, _count: true }),
    db.return.aggregate({ where: { storeId }, _sum: { refundAmount: true } }),
    db.saleItem.groupBy({
      by: ["productId"],
      where: { sale: { storeId } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    db.warehouse.findMany({ where: { storeId }, select: { id: true } }),
  ]);

  const warehouseIds = warehouses.map((w) => w.id);
  const lowStock = await db.warehouseStock.findMany({
    where: { warehouseId: { in: warehouseIds } },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
  const lowStockItems = lowStock.filter((s) => s.quantity <= s.lowStockThreshold);

  const productIds = topProducts.map((p) => p.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  return NextResponse.json({
    totalSales: salesAgg._sum.totalAmount ?? 0,
    totalRefunds: refundsAgg._sum.refundAmount ?? 0,
    salesCount: salesAgg._count,
    topProducts: topProducts.map((p) => ({
      product: productMap.get(p.productId) ?? null,
      quantitySold: p._sum.quantity ?? 0,
      revenue: p._sum.lineTotal ?? 0,
    })),
    lowStockItems: lowStockItems.map((s) => ({
      warehouseId: s.warehouseId,
      product: s.product,
      quantity: s.quantity,
      lowStockThreshold: s.lowStockThreshold,
    })),
  });
}, { scope: "tenant", roles: ["store_manager"], permission: "can_view_reports" });

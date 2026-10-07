import type { PrismaClient } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { round2 } from "@/lib/returns";
import { storeScopeWhere } from "@/lib/tenant-access";

/** Prisma hands Decimal columns back as an object; the client only ever wants a number. */
type DecimalLike = string | number | { toString(): string };

function toNum(value: DecimalLike): number {
  return round2(Number(typeof value === "object" ? value.toString() : value));
}

/**
 * The store's headline numbers.
 *
 * Lives here rather than inside the route so the dashboard and the Reports page
 * read the same query - the dashboard renders these server-side, and the Reports
 * page still fetches them over the API. Two copies of this would be free to
 * drift, and the first thing anyone would notice is the dashboard quietly
 * disagreeing with the report it is supposed to summarise.
 */
export type StoreReport = {
  totalSales: number;
  totalRefunds: number;
  salesCount: number;
  topProducts: {
    product: { id: number; sku: string; name: string } | null;
    quantitySold: number;
    revenue: number;
  }[];
  lowStockItems: {
    warehouseId: number;
    product: { id: number; sku: string; name: string };
    quantity: number;
    lowStockThreshold: number;
  }[];
};

/** How many products the "top sellers" list shows. */
const TOP_PRODUCT_LIMIT = 5;

/**
 * Sales, refunds, best sellers and low stock for the caller's store.
 *
 * Scoped by `storeScopeWhere`, so a store_manager and a store_user see their own
 * store while a company_admin (who has no store bound to the session) sees every
 * store - the same rule the rest of the store side already uses.
 */
export async function getStoreReport(db: PrismaClient, session: TenantSession): Promise<StoreReport> {
  const storeFilter = storeScopeWhere(session);

  const [salesAgg, refundsAgg, topProducts, warehouses] = await Promise.all([
    db.sale.aggregate({ where: storeFilter, _sum: { totalAmount: true }, _count: true }),
    db.return.aggregate({ where: storeFilter, _sum: { refundAmount: true } }),
    db.saleItem.groupBy({
      by: ["productId"],
      where: { sale: storeFilter },
      _sum: { stockQuantity: true, lineTotal: true },
      orderBy: { _sum: { stockQuantity: "desc" } },
      take: TOP_PRODUCT_LIMIT,
    }),
    db.warehouse.findMany({ where: storeFilter, select: { id: true } }),
  ]);

  // Read as one extra query rather than a per-row lookup: a warehouse holding a
  // few hundred products would otherwise cost a few hundred round trips.
  const warehouseIds = warehouses.map((w) => w.id);
  const lowStock = await db.warehouseStock.findMany({
    where: { warehouseId: { in: warehouseIds } },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
  const lowStockItems = lowStock.filter((s) => toNum(s.quantity) <= toNum(s.lowStockThreshold));

  const productIds = topProducts.map((p) => p.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  return {
    totalSales: toNum(salesAgg._sum.totalAmount ?? 0),
    totalRefunds: toNum(refundsAgg._sum.refundAmount ?? 0),
    salesCount: salesAgg._count,
    topProducts: topProducts.map((p) => ({
      product: productMap.get(p.productId) ?? null,
      quantitySold: toNum(p._sum.stockQuantity ?? 0),
      revenue: toNum(p._sum.lineTotal ?? 0),
    })),
    lowStockItems: lowStockItems.map((s) => ({
      warehouseId: s.warehouseId,
      product: s.product,
      quantity: toNum(s.quantity),
      lowStockThreshold: toNum(s.lowStockThreshold),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Per-day figures                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One day of the trend, plus the totals a selected day reports.
 *
 * `date` is a plain yyyy-mm-dd in the server's local time rather than an ISO
 * timestamp, because it is a calendar day the owner recognises ("the 14th") and
 * not an instant - it is also what the API accepts back as `?date=`.
 */
export type DailySales = {
  date: string;
  totalSales: number;
  totalRefunds: number;
  salesCount: number;
};

/** The sales behind one day, newest first, for the click-through panel. */
export type DaySale = {
  id: number;
  soldAt: string;
  customerName: string | null;
  cashierName: string | null;
  itemCount: number;
  totalAmount: number;
  status: string;
  methods: string[];
};

export type DayReport = DailySales & {
  sales: DaySale[];
  /** True when there were more sales than `sales` holds, so the panel can say so. */
  hasMoreSales: boolean;
};

/** Most days of history the trend will chart. Bounds the rows read per request. */
export const MAX_TREND_DAYS = 90;

/** Most sales listed for one day before the panel says there are more. */
const DAY_SALE_LIMIT = 50;

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight at the start of the given day. */
function localDayStart(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 0, 0, 0, 0);
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Resolves a yyyy-mm-dd key to local-midnight Date objects, or null if the
 * string is not a real calendar date.
 *
 * The round-trip check is what rejects 2026-02-31: the Date constructor would
 * happily roll that forward to 2 March, and a report that silently answered a
 * different question than the one asked is worse than one that refuses.
 */
export function resolveDayBounds(key: string): { start: Date; end: Date } | null {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = localDayStart(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    return null;
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Today's date key in local time. */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

/**
 * Daily sales and refunds for the last `days` days, oldest first and with gaps
 * filled in as zeroes.
 *
 * Bucketed in JS rather than with a raw `DATE(createdAt)` group-by: Prisma's
 * groupBy can only group by a column, and this app has no raw SQL anywhere. The
 * cost is one row per sale in the window instead of one row per day, which is
 * fine for a chart and would not be for a multi-year range - past
 * MAX_TREND_DAYS this wants a daily rollup table.
 */
export async function getDailySales(
  db: PrismaClient,
  session: TenantSession,
  days: number
): Promise<DailySales[]> {
  const span = Math.max(1, Math.min(Math.floor(days) || 1, MAX_TREND_DAYS));

  const today = localDayStart(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const start = new Date(today);
  start.setDate(start.getDate() - (span - 1));
  const end = new Date(today);
  end.setDate(end.getDate() + 1);

  const storeFilter = storeScopeWhere(session);
  const [sales, returns] = await Promise.all([
    db.sale.findMany({
      where: { ...storeFilter, createdAt: { gte: start, lt: end } },
      select: { createdAt: true, totalAmount: true },
    }),
    db.return.findMany({
      where: { ...storeFilter, createdAt: { gte: start, lt: end } },
      select: { createdAt: true, refundAmount: true },
    }),
  ]);

  // Seeded from the date list rather than from the rows, so a day with no sales
  // is still a column on the chart instead of silently closing the gap.
  const buckets = new Map<string, DailySales>();
  for (let i = 0; i < span; i++) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    buckets.set(toDateKey(day), { date: toDateKey(day), totalSales: 0, totalRefunds: 0, salesCount: 0 });
  }

  for (const sale of sales) {
    const bucket = buckets.get(toDateKey(sale.createdAt));
    if (!bucket) continue;
    bucket.totalSales = round2(bucket.totalSales + toNum(sale.totalAmount));
    bucket.salesCount += 1;
  }
  for (const entry of returns) {
    const bucket = buckets.get(toDateKey(entry.createdAt));
    if (!bucket) continue;
    bucket.totalRefunds = round2(bucket.totalRefunds + toNum(entry.refundAmount));
  }

  return [...buckets.values()];
}

/**
 * One day's totals plus the sales behind them.
 *
 * Same store scoping as every other report, and refuses a date that is not a real
 * day rather than answering for the wrong one.
 */
export async function getDayReport(
  db: PrismaClient,
  session: TenantSession,
  dateKey: string
): Promise<DayReport | null> {
  const bounds = resolveDayBounds(dateKey);
  if (!bounds) return null;

  const storeFilter = storeScopeWhere(session);
  const createdAt = { gte: bounds.start, lt: bounds.end };

  const [salesAgg, refundsAgg, sales] = await Promise.all([
    db.sale.aggregate({ where: { ...storeFilter, createdAt }, _sum: { totalAmount: true }, _count: true }),
    db.return.aggregate({ where: { ...storeFilter, createdAt }, _sum: { refundAmount: true } }),
    db.sale.findMany({
      where: { ...storeFilter, createdAt },
      orderBy: { createdAt: "desc" },
      take: DAY_SALE_LIMIT + 1,
        select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        status: true,
        customer: { select: { name: true } },
        cashierId: true,
        _count: { select: { items: true } },
        payments: { select: { method: true } },
      },
    }),
  ]);

  // One row too many is how the panel knows to say "and N more" instead of
  // implying the list is complete.
  const hasMoreSales = sales.length > DAY_SALE_LIMIT;
  const page = hasMoreSales ? sales.slice(0, DAY_SALE_LIMIT) : sales;

  return {
    date: dateKey,
    totalSales: toNum(salesAgg._sum.totalAmount ?? 0),
    totalRefunds: toNum(refundsAgg._sum.refundAmount ?? 0),
    salesCount: salesAgg._count,
    sales: page.map((sale) => ({
      id: sale.id,
      soldAt: sale.createdAt.toISOString(),
      customerName: sale.customer?.name ?? null,
      cashierName: sale.cashierId ? String(sale.cashierId) : null,
      itemCount: sale._count.items,
      totalAmount: toNum(sale.totalAmount),
      status: sale.status,
      methods: sale.payments.map((p) => p.method),
    })),
    hasMoreSales,
  };
}
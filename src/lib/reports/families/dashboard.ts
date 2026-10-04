import { round2 } from "@/lib/returns";
import { add, finish, num, pct } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { categoryMap, productMap, storeMap, warehouseMap, warehouseScope } from "../lookups";
import { previousPeriod as windowBefore } from "../period";
import type { ReportColumn, ReportRow } from "../types";

/**
 * The dashboard family - one page that answers "how is the business doing" and
 * then points at the report that explains it.
 *
 * A management dashboard is the one place where it is worth showing the window
 * next to a comparison, because "revenue is up" is only a sentence if you can see
 * what it was up from. So every figure here carries the window immediately before
 * it beside it, which is why each dashboard report asks for two snapshots.
 */

const isWindow = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

/** The equally long window immediately before this one, for the deltas. */
function previousPeriod(ctx: ReportContext): { start: Date; end: Date } {
  return windowBefore(ctx.period);
}

const inRange = (start: Date, end: Date) => ({ gte: start, lt: end });

/** A figure with the window before it and the change between them. */
type Trend = { value: number; previous: number; change: number; rate: number };

function trend(value: number, previous: number): Trend {
  const change = round2(value - previous);
  return { value, previous, change, rate: previous === 0 ? 0 : round2((change / Math.abs(previous)) * 100) };
}

const money = (key: string, label: string, current: Trend, note?: string) => ({
  key,
  label,
  value: current.value,
  type: "money" as const,
  previous: current.previous,
  change: current.change,
  changeRate: current.rate,
  note,
});

const count = (key: string, label: string, current: Trend, note?: string) => ({
  key,
  label,
  value: current.value,
  type: "number" as const,
  previous: current.previous,
  change: current.change,
  changeRate: current.rate,
  note,
});

/** Everything the dashboard shows, computed once per request. */
async function snapshot(ctx: ReportContext, start: Date, end: Date) {
  const sales = await ctx.db.sale.findMany({
    where: { ...ctx.storeFilter, createdAt: inRange(start, end) },
    select: {
      totalAmount: true,
      discountAmount: true,
      taxAmount: true,
      items: { select: { quantity: true, productId: true, lineTotal: true } },
      payments: { select: { method: true, amount: true } },
      returns: { select: { refundAmount: true } },
    },
  });
  const [purchases, expenses, returns, supplierReturns, customers, stock, products, categories, stores, users] = await Promise.all([
    ctx.db.purchaseItem.findMany({
      where: { purchase: { purchasedAt: inRange(start, end) }, ...warehouseScope(ctx) },
      select: { productId: true, quantity: true, unitCost: true },
    }),
    ctx.db.expenditure.findMany({
      where: { isActive: true, expenditureDate: inRange(start, end) },
      select: { totalAmount: true, paidAmount: true, isPaid: true },
    }),
    ctx.db.return.findMany({
      where: { ...ctx.storeFilter, createdAt: inRange(start, end) },
      select: { refundAmount: true, items: { select: { quantity: true, restocked: true } } },
    }),
    ctx.db.supplierReturn.findMany({
      where: { ...warehouseScope(ctx), createdAt: inRange(start, end) },
      select: { quantity: true, amount: true },
    }),
    ctx.db.customer.findMany({
      where: { sales: { some: { ...ctx.storeFilter, createdAt: inRange(start, end) } } },
      select: { id: true, dueAmount: true, loyaltyPoints: true },
    }),
    ctx.db.warehouseStock.findMany({
      where: warehouseScope(ctx),
      select: { quantity: true, lowStockThreshold: true, productId: true },
    }),
    ctx.db.product.findMany({ where: { isActive: true }, select: { id: true, categoryId: true, purchasePrice: true, salePrice: true } }),
    ctx.db.category.findMany({ select: { id: true, name: true } }),
    ctx.db.store.findMany({ where: { isActive: true }, select: { id: true } }),
    ctx.db.user.findMany({ where: { isActive: true }, select: { id: true } }),
  ]);

  const revenue = add(...sales.map((sale) => num(sale.totalAmount)));
  const invoiceDiscount = add(...sales.map((sale) => num(sale.discountAmount)));
  const tax = add(...sales.map((sale) => num(sale.taxAmount)));
  const quantity = add(...sales.map((sale) => add(...sale.items.map((item) => item.quantity))));
  const soldIds = new Set(sales.flatMap((sale) => sale.items.map((item) => item.productId)));
  const collected = add(...sales.map((sale) => add(...sale.payments.map((payment) => num(payment.amount)))));
  const refunded = add(...returns.map((entry) => num(entry.refundAmount)));
  const restocked = add(
    ...returns.flatMap((entry) => entry.items.filter((item) => item.restocked).map((item) => item.quantity))
  );
  const purchaseCost = add(...purchases.map((item) => num(item.unitCost) * item.quantity));
  const purchaseQuantity = add(...purchases.map((item) => item.quantity));
  const expenseTotal = add(...expenses.map((voucher) => num(voucher.totalAmount)));
  const expensePaid = add(...expenses.map((voucher) => num(voucher.paidAmount)));
  const expenseUnpaid = round2(expenseTotal - expensePaid);
  const supplierCredit = add(...supplierReturns.map((entry) => num(entry.amount)));

  const productById = new Map(products.map((product) => [product.id, product]));
  const stockByProduct = new Map<number, number>();
  for (const row of stock) {
    stockByProduct.set(row.productId, num(stockByProduct.get(row.productId) ?? 0) + row.quantity);
  }
  const lowStock = stock.filter((row) => row.quantity <= row.lowStockThreshold && (stockByProduct.get(row.productId) ?? 0) > 0).length;
  const outOfStock = stock.filter((row) => row.quantity <= 0).length;
  const stockValue = add(
    ...[...stockByProduct.entries()].map(([id, quantityHeld]) => num(productById.get(id)?.purchasePrice ?? 0) * quantityHeld)
  );
  const retailValue = add(
    ...[...stockByProduct.entries()].map(([id, quantityHeld]) => num(productById.get(id)?.salePrice ?? 0) * quantityHeld)
  );
  const receivable = add(...customers.map((customer) => customer.dueAmount));

  // Cost of what was sold, at each product's CURRENT purchase price - there is
  // no cost snapshot on a sale line, so this is an estimate and the note says so.
  const costOfGoods = add(
    ...sales.flatMap((sale) =>
      sale.items.map((item) => num(productById.get(item.productId)?.purchasePrice ?? 0) * item.quantity)
    )
  );
  const gross = round2(revenue - costOfGoods);
  const profit = round2(gross - refunded - expensePaid);

  return {
    revenue,
    invoiceDiscount,
    tax,
    quantity,
    invoices: sales.length,
    soldProducts: soldIds.size,
    collected,
    creditSales: round2(revenue - collected),
    refunded,
    returns: returns.length,
    restocked,
    nonRestocked: round2(add(...returns.flatMap((entry) => entry.items.filter((item) => !item.restocked).map((item) => item.quantity)))),
    purchaseCost,
    purchaseQuantity,
    purchaseLines: purchases.length,
    supplierReturns: supplierReturns.length,
    supplierCredit,
    expenseTotal,
    expensePaid,
    expenseUnpaid,
    expenseVouchers: expenses.length,
    customers: customers.length,
    receivable,
    loyaltyPoints: add(...customers.map((customer) => customer.loyaltyPoints)),
    lowStock,
    outOfStock,
    stockValue,
    retailValue,
    potentialMargin: retailValue - stockValue,
    products: products.length,
    categories: categories.length,
    stores: stores.length,
    staff: users.length,
    costOfGoods,
    gross,
    profit,
    grossMargin: pct(gross, revenue),
    netMargin: pct(profit, revenue),
  };
}

export const dashboardReports: ReportDefinition[] = [
  {
    key: "dashboard-overview",
    family: "dashboard",
    title: "reports.report.dashboardOverview",
    description: "reports.desc.dashboardOverview",
    build: async (ctx) => {
      const previous = previousPeriod(ctx);
      const [now, before] = await Promise.all([
        snapshot(ctx, ctx.period.start, ctx.period.end),
        snapshot(ctx, previous.start, previous.end),
      ]);
      return finish({
        key: "dashboard-overview",
        title: "reports.report.dashboardOverview",
        period: ctx.period,
        columns: [],
        rows: [],
        metrics: [],
        blocks: [
          {
            title: "reports.block.salesPerformance",
            items: [
              money("revenue", "reports.col.revenue", trend(now.revenue, before.revenue)),
              count("invoices", "reports.col.invoices", trend(now.invoices, before.invoices)),
              count("qtySold", "reports.col.qtySold", trend(now.quantity, before.quantity)),
              money("collected", "reports.col.collected", trend(now.collected, before.collected)),
              money("creditSales", "reports.col.creditSales", trend(now.creditSales, before.creditSales)),
              money("invoiceDiscount", "reports.col.invoiceDiscount", trend(now.invoiceDiscount, before.invoiceDiscount)),
            ],
          },
          {
            title: "reports.block.profitability",
            items: [
              money("revenue", "reports.col.revenue", trend(now.revenue, before.revenue)),
              money("costOfGoods", "reports.col.costOfGoods", trend(now.costOfGoods, before.costOfGoods)),
              money("grossProfit", "reports.col.grossProfit", trend(now.gross, before.gross)),
              count("grossMargin", "reports.col.grossMargin", trend(now.grossMargin, before.grossMargin), "reports.note.marginIsPercent"),
              money("netProfit", "reports.col.netProfit", trend(now.profit, before.profit)),
              count("netMargin", "reports.col.netMargin", trend(now.netMargin, before.netMargin), "reports.note.marginIsPercent"),
            ],
          },
          {
            title: "reports.block.money",
            items: [
              money("receivable", "reports.col.receivable", trend(now.receivable, before.receivable)),
              money("expenses", "reports.col.expenses", trend(now.expensePaid, before.expensePaid)),
              money("expensesUnpaid", "reports.col.expensesUnpaid", trend(now.expenseUnpaid, before.expenseUnpaid)),
              money("stockValue", "reports.col.stockValueAtCost", trend(now.stockValue, before.stockValue)),
              money("retailValue", "reports.col.stockValueAtRetail", trend(now.retailValue, before.retailValue)),
              money("supplierCredit", "reports.col.supplierCredit", trend(now.supplierCredit, before.supplierCredit)),
            ],
          },
          {
            title: "reports.block.activity",
            items: [
              count("customers", "reports.col.activeCustomers", trend(now.customers, before.customers)),
              count("returns", "reports.col.returns", trend(now.returns, before.returns)),
              money("refunded", "reports.col.refunded", trend(now.refunded, before.refunded)),
              count("restocked", "reports.col.restocked", trend(now.restocked, before.restocked)),
              count("purchases", "reports.col.purchaseLines", trend(now.purchaseLines, before.purchaseLines)),
              money("purchaseCost", "reports.col.purchaseCost", trend(now.purchaseCost, before.purchaseCost)),
            ],
          },
          {
            title: "reports.block.health",
            items: [
              count("lowStock", "reports.col.lowStockItems", trend(now.lowStock, before.lowStock)),
              count("outOfStock", "reports.col.outOfStockItems", trend(now.outOfStock, before.outOfStock)),
              count("products", "reports.col.activeProducts", trend(now.products, before.products)),
              count("categories", "reports.col.categories", trend(now.categories, before.categories)),
              count("stores", "reports.col.stores", trend(now.stores, before.stores)),
              count("staff", "reports.col.activeStaff", trend(now.staff, before.staff)),
            ],
          },
        ],
        notes: [
          "reports.note.comparesWithPreviousWindow",
          "reports.note.costHasNoSaleSnapshot",
          "reports.note.expenseIsCompanyWide",
          "reports.note.stockValueIsCompanyWideForAdmin",
          "reports.note.dashboardHasNoChartInPdf",
        ],
      });
    },
  },
  {
    key: "dashboard-performance",
    family: "dashboard",
    title: "reports.report.dashboardPerformance",
    description: "reports.desc.dashboardPerformance",
    build: async (ctx) => {
      const previous = previousPeriod(ctx);
      const [now, before] = await Promise.all([
        snapshot(ctx, ctx.period.start, ctx.period.end),
        snapshot(ctx, previous.start, previous.end),
      ]);
      const sales = await ctx.db.sale.findMany({
        where: { ...ctx.storeFilter, createdAt: isWindow(ctx) },
        select: { warehouseId: true, customerId: true, totalAmount: true, items: { select: { quantity: true, productId: true, lineTotal: true } } },
      });
      const [warehouses, productInfo] = await Promise.all([
        warehouseMap(ctx),
        productMap(
          ctx.db,
          sales.flatMap((sale) => sale.items.map((item) => item.productId))
        ),
      ]);
      const categories = await categoryMap(
        ctx.db,
        [...productInfo.values()].map((product) => product.categoryId).filter((id): id is number => id !== null)
      );

      // Per store, which only a company admin can see as separate rows.
      const stores = await storeMap(ctx.db);
      const byStore = new Map<number, ReportRow>();
      const storeRows = await ctx.db.sale.groupBy({
        by: ["storeId"],
        where: { ...ctx.storeFilter, createdAt: isWindow(ctx) },
        _count: { _all: true },
        _sum: { totalAmount: true },
      });
      for (const entry of storeRows) {
        const storeId = entry.storeId;
        byStore.set(storeId, {
          store: stores.get(storeId)?.name ?? `#${storeId}`,
          storeId,
          invoices: entry._count._all,
          revenue: num(entry._sum.totalAmount),
          revenueShare: pct(num(entry._sum.totalAmount), now.revenue),
          trend: null,
        });
      }

      // Per warehouse in scope.
      const byWarehouse = new Map<number, ReportRow>();
      for (const sale of sales) {
        let row = byWarehouse.get(sale.warehouseId);
        if (!row) {
          row = {
            warehouse: warehouses.get(sale.warehouseId)?.name ?? `#${sale.warehouseId}`,
            store: warehouses.get(sale.warehouseId)?.storeId === undefined ? null : (stores.get(warehouses.get(sale.warehouseId)!.storeId)?.name ?? null),
            invoices: 0,
            revenue: 0,
            qty: 0,
            share: 0,
          };
          byWarehouse.set(sale.warehouseId, row);
        }
        row.invoices = num(row.invoices) + 1;
        row.revenue = add(num(row.revenue), num(sale.totalAmount));
        row.qty = add(num(row.qty), ...sale.items.map((item) => item.quantity));
      }
      for (const row of byWarehouse.values()) row.share = pct(num(row.revenue), now.revenue);

      // Top lines by revenue at the price they were actually sold at.
      const lineProducts = new Map<number, { quantity: number; value: number }>();
      for (const sale of sales) {
        for (const item of sale.items) {
          const held = lineProducts.get(item.productId) ?? { quantity: 0, value: 0 };
          lineProducts.set(item.productId, {
            quantity: held.quantity + item.quantity,
            value: add(held.value, num(item.lineTotal)),
          });
        }
      }
      const topLines: ReportRow[] = [...lineProducts.entries()]
        .map(([productId, held]) => {
          const categoryId = productInfo.get(productId)?.categoryId ?? null;
          return {
            product: productInfo.get(productId)?.name ?? `#${productId}`,
            sku: productInfo.get(productId)?.sku ?? null,
            category: categoryId === null ? null : (categories.get(categoryId) ?? null),
            quantity: held.quantity,
            value: held.value,
            share: pct(held.value, now.revenue),
          };
        })
        .sort((a, b) => num(b.value) - num(a.value))
        .slice(0, 10);

      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.name", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
        { key: "change", label: "reports.col.changeVsPrevious", type: "percent" },
      ];
      const rows: ReportRow[] = [
        ...[...byStore.values()].map((row) => ({ ...row, name: row.store, change: null })),
        ...[...byWarehouse.values()].map((row) => ({ ...row, name: row.warehouse, change: null })),
        ...topLines.map((row) => ({ ...row, name: row.product, invoices: null, revenue: row.value, change: null })),
      ];
      return finish({
        key: "dashboard-performance",
        title: "reports.report.dashboardPerformance",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          money("revenue", "reports.col.revenue", trend(now.revenue, before.revenue)),
          count("invoices", "reports.col.invoices", trend(now.invoices, before.invoices)),
          count("grossMargin", "reports.col.grossMargin", trend(now.grossMargin, before.grossMargin), "reports.note.marginIsPercent"),
          money("netProfit", "reports.col.netProfit", trend(now.profit, before.profit)),
        ],
        notes: [
          "reports.note.mixedStoreWarehouseProductRows",
          "reports.note.comparesWithPreviousWindow",
          "reports.note.topLinesUseCurrentSalePrice",
          ...(ctx.scopedToStore ? ["reports.note.scopedToOneStore"] : []),
        ],
      });
    },
  },
  {
    key: "dashboard-quick-stats",
    family: "dashboard",
    title: "reports.report.dashboardQuickStats",
    description: "reports.desc.dashboardQuickStats",
    build: async (ctx) => {
      const previous = previousPeriod(ctx);
      const [now, before, bankRows, payables] = await Promise.all([
        snapshot(ctx, ctx.period.start, ctx.period.end),
        snapshot(ctx, previous.start, previous.end),
        ctx.db.bankInfo.findMany({ where: { isActive: true }, select: { bankName: true, remainingBalance: true, initialBalance: true } }),
        ctx.db.supplier.aggregate({ _sum: { dueAmount: true }, _count: { _all: true } }),
      ]);
      const liquid = add(...bankRows.map((row) => row.remainingBalance));
      const declared = add(...bankRows.map((row) => row.initialBalance));
      const columns: ReportColumn[] = [
        { key: "stat", label: "reports.col.stat", type: "key" },
        { key: "value", label: "reports.col.value", type: "money" },
        { key: "previous", label: "reports.col.previousWindow", type: "money" },
        { key: "change", label: "reports.col.changeVsPrevious", type: "money" },
      ];
      const pairs: [string, string, Trend][] = [
        ["reports.stat.revenue", "reports.col.revenue", trend(now.revenue, before.revenue)],
        ["reports.stat.grossProfit", "reports.col.grossProfit", trend(now.gross, before.gross)],
        ["reports.stat.netProfit", "reports.col.netProfit", trend(now.profit, before.profit)],
        ["reports.stat.expenses", "reports.col.expenses", trend(now.expensePaid, before.expensePaid)],
        ["reports.stat.purchaseCost", "reports.col.purchaseCost", trend(now.purchaseCost, before.purchaseCost)],
        ["reports.stat.refunded", "reports.col.refunded", trend(now.refunded, before.refunded)],
        ["reports.stat.receivable", "reports.col.receivable", trend(now.receivable, before.receivable)],
        ["reports.stat.payable", "reports.col.payable", trend(num(payables._sum.dueAmount ?? 0), 0)],
        ["reports.stat.cashInHand", "reports.col.cashInHand", trend(liquid, 0)],
      ];
      const rows: ReportRow[] = pairs.map(([label, , current]) => ({
        stat: label,
        value: current.value,
        previous: current.previous,
        change: current.change,
      }));
      return finish({
        key: "dashboard-quick-stats",
        title: "reports.report.dashboardQuickStats",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          money("revenue", "reports.col.revenue", trend(now.revenue, before.revenue)),
          money("netProfit", "reports.col.netProfit", trend(now.profit, before.profit)),
          money("cashInHand", "reports.col.cashInHand", trend(liquid, 0)),
          money("payable", "reports.col.payable", trend(num(payables._sum.dueAmount ?? 0), 0)),
          money("declared", "reports.col.declaredOpeningBalance", trend(declared, 0)),
          count("staff", "reports.col.activeStaff", trend(now.staff, before.staff)),
        ],
        notes: [
          "reports.note.comparesWithPreviousWindow",
          "reports.note.balancesAreSnapshotNotWindow",
          "reports.note.cashInHandIsCompanyWide",
          "reports.note.payableHasNoPreviousColumnInSchema",
          "reports.note.stockValueIsCompanyWideForAdmin",
        ],
      });
    },
  },
  {
    key: "dashboard-alerts",
    family: "dashboard",
    title: "reports.report.dashboardAlerts",
    description: "reports.desc.dashboardAlerts",
    build: async (ctx) => {
      const previous = previousPeriod(ctx);
      const now = await snapshot(ctx, ctx.period.start, ctx.period.end);
      const before = await snapshot(ctx, previous.start, previous.end);
      const stock = await ctx.db.warehouseStock.findMany({
        where: warehouseScope(ctx),
        select: { productId: true, quantity: true, lowStockThreshold: true, warehouse: { select: { name: true, storeId: true } } },
      });
      const products = await productMap(
        ctx.db,
        stock.map((row) => row.productId)
      );
      const stores = await storeMap(ctx.db);
      const unpaid = await ctx.db.expenditure.findMany({
        where: { isActive: true, isPaid: false, expenditureDate: isWindow(ctx) },
        select: { id: true, totalAmount: true, expenditureDate: true, note: true },
      });
      const unpaidTotal = add(...unpaid.map((voucher) => num(voucher.totalAmount)));
      const lowRows = stock
        .filter((row) => row.quantity <= row.lowStockThreshold)
        .map((row) => ({
          alert: row.quantity <= 0 ? "reports.alert.outOfStock" : "reports.alert.lowStock",
          severity: row.quantity <= 0 ? "reports.severity.critical" : "reports.severity.warning",
          item: products.get(row.productId)?.name ?? `#${row.productId}`,
          sku: products.get(row.productId)?.sku ?? null,
          warehouse: row.warehouse.name,
          store: row.warehouse.storeId === ctx.storeFilter.storeId || !ctx.scopedToStore ? (stores.get(row.warehouse.storeId)?.name ?? null) : null,
          quantity: row.quantity,
          threshold: row.lowStockThreshold,
          gap: row.lowStockThreshold - row.quantity,
          suggestedPurchase: round2((row.lowStockThreshold - row.quantity) * num(products.get(row.productId)?.purchasePrice ?? 0)),
        }));
      const columns: ReportColumn[] = [
        { key: "alert", label: "reports.col.alert", type: "badge" },
        { key: "severity", label: "reports.col.severity", type: "badge" },
        { key: "item", label: "reports.col.item", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "warehouse", label: "reports.col.warehouse", type: "text" },
        { key: "store", label: "reports.col.store", type: "text" },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "threshold", label: "reports.col.threshold", type: "quantity", sum: true },
        { key: "gap", label: "reports.col.gap", type: "quantity", sum: true },
        { key: "suggestedPurchase", label: "reports.col.suggestedPurchase", type: "money", sum: true },
      ];
      return finish({
        key: "dashboard-alerts",
        title: "reports.report.dashboardAlerts",
        period: ctx.period,
        columns,
        rows: lowRows,
        metrics: [
          count("lowStock", "reports.col.lowStockItems", trend(now.lowStock, before.lowStock)),
          count("outOfStock", "reports.col.outOfStockItems", trend(now.outOfStock, before.outOfStock)),
          count("unpaidVouchers", "reports.col.unpaidVouchers", trend(unpaid.length, 0)),
          money("unpaidTotal", "reports.col.unpaidAmount", trend(unpaidTotal, 0)),
        ],
        notes: [
          "reports.note.alertsUseLiveStockNotWindow",
          "reports.note.thresholdIsPerWarehouseRow",
          "reports.note.noExpiryOrBatchAlertsWithoutSchema",
          ...(ctx.scopedToStore ? ["reports.note.scopedToOneStore"] : []),
        ],
      });
    },
  },
];
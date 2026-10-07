import { add, finish, num, pct, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { categoryMap, productMap, storeMap, userMap } from "../lookups";
import { bucketKey, type BucketKind } from "../period";
// The dashboard's own MAX_TREND_DAYS, reused so "how far back may a trend go" is
// one number in the app rather than one per module.
import { MAX_TREND_DAYS } from "../../reports";
import { ReportError, type ReportColumn, type ReportMetric, type ReportRow } from "../types";

/**
 * Sales reports - the thirteen views of Sale / SaleItem / SalePayment.
 *
 * Two things to know before reading the figures:
 *
 * 1. Line revenue is `SaleItem.lineTotal`: the money for that line after its own
 *    discount. Summing line totals does NOT always tie back to summing
 *    `Sale.totalAmount`, because an invoice-level discount is only recorded on
 *    the Sale. Reports that mix the two say so in a note rather than showing two
 *    totals that quietly disagree.
 * 2. Nothing here filters on `status`. A refunded sale is still a sale that
 *    happened; the money is reported as sales with the refund alongside.
 *    Netting it away would hide both halves of what happened.
 */

const within = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

/** Line rows for the window. Product names come from a lookup, not an include:
 *  SaleItem keeps productId as a bare column. */
function windowItems(ctx: ReportContext) {
  return ctx.db.saleItem.findMany({
    where: { sale: { ...ctx.storeFilter, createdAt: within(ctx) } },
    select: {
      quantity: true,
      stockQuantity: true,
      unitPrice: true,
      discountAmount: true,
      lineTotal: true,
      productId: true,
      saleId: true,
      sale: {
        select: {
          storeId: true,
          createdAt: true,
          cashierId: true,
          customerId: true,
          discountAmount: true,
          totalAmount: true,
          status: true,
        },
      },
    },
  });
}

type WindowItem = Awaited<ReturnType<typeof windowItems>>[number];

/** One row per product sold in the window.
 *
 * `categoryId` stays on the row even though no report prints it, because the
 * category report groups by it - the renderer walks `columns`, so an extra key
 * costs nothing on screen.
 */
async function productTotals(ctx: ReportContext, items: WindowItem[]): Promise<ReportRow[]> {
  const products = await productMap(
    ctx.db,
    items.map((item) => item.productId)
  );
  const rows = new Map<number, ReportRow>();
  for (const item of items) {
    const product = products.get(item.productId);
    let row = rows.get(item.productId);
    if (!row) {
      row = {
        productId: item.productId,
        name: product?.name ?? null,
        sku: product?.sku ?? null,
        categoryId: product?.categoryId ?? null,
        quantity: 0,
        gross: 0,
        discount: 0,
        revenue: 0,
        cost: 0,
        lines: 0,
      };
      rows.set(item.productId, row);
    }
    const quantity = num(item.quantity);
    const stockQuantity = num(item.stockQuantity);
    row.quantity = num(row.quantity) + stockQuantity;
    row.gross = add(num(row.gross), quantity * num(item.unitPrice));
    row.discount = add(num(row.discount), num(item.discountAmount));
    row.revenue = add(num(row.revenue), num(item.lineTotal));
    // Cost of goods uses the product's CURRENT purchase price. The schema has no
    // cost snapshot on a sale line, so this is the only cost a reader can check
    // by hand - the profit reports say so where they use it.
    row.cost = add(num(row.cost), (product?.purchasePrice ?? 0) * stockQuantity);
    row.lines = num(row.lines) + 1;
  }
  return [...rows.values()];
}

const PRODUCT_COLUMNS: ReportColumn[] = [
  { key: "name", label: "reports.col.product", type: "text" },
  { key: "sku", label: "reports.col.sku", type: "text" },
  { key: "lines", label: "reports.col.invoiceLines", type: "number", sum: true },
  { key: "quantity", label: "reports.col.qtySold", type: "quantity", sum: true },
  { key: "gross", label: "reports.col.gross", type: "money", sum: true },
  { key: "discount", label: "reports.col.discount", type: "money", sum: true },
  { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
  { key: "cost", label: "reports.col.cost", type: "money", sum: true },
];

/** The seven columns every time-series sales report shares. */
function periodColumns(label: string, type: ReportColumn["type"]): ReportColumn[] {
  return [
    { key: "bucket", label, type },
    { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
    { key: "items", label: "reports.col.items", type: "quantity", sum: true },
    { key: "gross", label: "reports.col.gross", type: "money", sum: true },
    { key: "discount", label: "reports.col.discount", type: "money", sum: true },
    { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
    { key: "net", label: "reports.col.net", type: "money", sum: true },
    { key: "average", label: "reports.col.average", type: "money", sum: true },
  ];
}

/** Sales and refunds per calendar bucket.
 *
 *  This holds one entry per sale in memory and buckets in JS, because the app
 *  uses no raw SQL and Prisma's groupBy cannot group by a date expression. The
 *  MAX_TREND_DAYS guard is what stops that becoming an unbounded read.
 */
async function bucketSales(ctx: ReportContext, bucket: BucketKind): Promise<ReportRow[]> {
  const spanDays = Math.ceil((ctx.period.end.getTime() - ctx.period.start.getTime()) / 86_400_000);
  if (spanDays > MAX_TREND_DAYS) {
    throw new ReportError(
      400,
      `This report reads one row per sale, so it covers at most ${MAX_TREND_DAYS} days. Choose a shorter period.`
    );
  }

  const [sales, returns] = await Promise.all([
    ctx.db.sale.findMany({
      where: { ...ctx.storeFilter, createdAt: within(ctx) },
      select: {
        createdAt: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        _count: { select: { items: true } },
      },
    }),
    ctx.db.return.findMany({
      where: { ...ctx.storeFilter, createdAt: within(ctx) },
      select: { createdAt: true, refundAmount: true },
    }),
  ]);

  const rows = new Map<string, ReportRow>();
  const touch = (key: string): ReportRow => {
    let row = rows.get(key);
    if (!row) {
      row = { bucket: key, invoices: 0, items: 0, gross: 0, discount: 0, refunded: 0, net: 0, average: 0 };
      rows.set(key, row);
    }
    return row;
  };

  for (const sale of sales) {
    const row = touch(bucketKey(sale.createdAt, bucket));
    row.invoices = num(row.invoices) + 1;
    row.items = num(row.items) + sale._count.items;
    row.gross = add(num(row.gross), num(sale.subtotal));
    row.discount = add(num(row.discount), num(sale.discountAmount));
    row.net = add(num(row.net), num(sale.totalAmount));
  }
  for (const entry of returns) {
    const row = touch(bucketKey(entry.createdAt, bucket));
    row.refunded = add(num(row.refunded), num(entry.refundAmount));
  }

  return [...rows.values()]
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)))
    .map((row) => {
      const invoices = num(row.invoices);
      const net = add(num(row.net), -num(row.refunded));
      return { ...row, net, average: invoices ? num(net / invoices) : 0 };
    });
}

/** The headline figures a time-series sales report shows above its chart. */
function periodMetrics(rows: ReportRow[]): ReportMetric[] {
  const sum = (key: string) => add(...rows.map((row) => num(row[key])));
  const invoices = sum("invoices");
  const net = sum("net");
  return [
    { key: "gross", label: "reports.col.gross", value: sum("gross"), type: "money" },
    { key: "discount", label: "reports.col.discount", value: sum("discount"), type: "money" },
    { key: "refunded", label: "reports.col.refunded", value: sum("refunded"), type: "money" },
    { key: "net", label: "reports.col.net", value: net, type: "money", negative: net < 0 },
    { key: "invoices", label: "reports.col.invoices", value: invoices, type: "number" },
    { key: "items", label: "reports.col.items", value: sum("items"), type: "quantity" },
    { key: "average", label: "reports.col.average", value: invoices ? num(net / invoices) : 0, type: "money" },
  ];
}

/** Sales, returns and the invoice detail they hang off, read once so the
 *  customer, cashier and store reports all describe the same set of invoices. */
function windowSales(ctx: ReportContext) {
  return ctx.db.sale.findMany({
    where: { ...ctx.storeFilter, createdAt: within(ctx) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      storeId: true,
      warehouseId: true,
      cashierId: true,
      customerId: true,
      status: true,
      subtotal: true,
      discountAmount: true,
      taxAmount: true,
      totalAmount: true,
      customer: { select: { name: true, phone: true, dueAmount: true } },
      payments: { select: { method: true, amount: true } },
      _count: { select: { items: true } },
      returns: { select: { refundAmount: true } },
    },
  });
}

type WindowSale = Awaited<ReturnType<typeof windowSales>>[number];

const paidOf = (sale: WindowSale) => add(...sale.payments.map((payment) => num(payment.amount)));
const refundedOf = (sale: WindowSale) => add(...sale.returns.map((entry) => num(entry.refundAmount)));

/** Groups sales by a key on each sale and accumulates the invoice-level money
 *  figures - the shape every "sales by X" report needs, with X differing only in
 *  how it picks the group label. */
function groupSales(sales: WindowSale[], label: (sale: WindowSale) => string) {
  const groups = new Map<string, ReportRow>();
  for (const sale of sales) {
    const key = label(sale);
    let row = groups.get(key);
    if (!row) {
      row = {
        name: key === "" ? null : key,
        invoices: 0,
        items: 0,
        subtotal: 0,
        discount: 0,
        total: 0,
        paid: 0,
        refunded: 0,
      };
      groups.set(key, row);
    }
    row.invoices = num(row.invoices) + 1;
    row.items = num(row.items) + sale._count.items;
    row.subtotal = add(num(row.subtotal), num(sale.subtotal));
    row.discount = add(num(row.discount), num(sale.discountAmount));
    row.total = add(num(row.total), num(sale.totalAmount));
    row.paid = add(num(row.paid), paidOf(sale));
    row.refunded = add(num(row.refunded), refundedOf(sale));
  }
  for (const row of groups.values()) {
    row.average = num(row.invoices) ? num(num(row.total) / num(row.invoices)) : 0;
  }
  return [...groups.values()];
}

export const salesReports: ReportDefinition[] = [
  {
    key: "sales-daily",
    family: "sales",
    maxRangeDays: MAX_TREND_DAYS,
    title: "reports.report.salesDaily",
    description: "reports.desc.salesDaily",
    build: async (ctx) => {
      const rows = await bucketSales(ctx, "day");
      return finish({
        key: "sales-daily",
        title: "reports.report.salesDaily",
        period: ctx.period,
        columns: periodColumns("reports.col.date", "date"),
        rows,
        metrics: periodMetrics(rows),
        notes: ["reports.note.netAfterRefunds"],
      });
    },
  },
  {
    key: "sales-weekly",
    family: "sales",
    maxRangeDays: MAX_TREND_DAYS,
    title: "reports.report.salesWeekly",
    description: "reports.desc.salesWeekly",
    build: async (ctx) => {
      const rows = await bucketSales(ctx, "week");
      return finish({
        key: "sales-weekly",
        title: "reports.report.salesWeekly",
        period: ctx.period,
        columns: periodColumns("reports.col.weekStarting", "date"),
        rows,
        metrics: periodMetrics(rows),
        notes: ["reports.note.weekStartsMonday", "reports.note.netAfterRefunds"],
      });
    },
  },
  {
    key: "sales-monthly",
    family: "sales",
    maxRangeDays: MAX_TREND_DAYS,
    title: "reports.report.salesMonthly",
    description: "reports.desc.salesMonthly",
    build: async (ctx) => {
      const rows = await bucketSales(ctx, "month");
      return finish({
        key: "sales-monthly",
        title: "reports.report.salesMonthly",
        period: ctx.period,
        columns: periodColumns("reports.col.month", "text"),
        rows,
        metrics: periodMetrics(rows),
        notes: ["reports.note.netAfterRefunds"],
      });
    },
  },
  {
    key: "sales-yearly",
    family: "sales",
    maxRangeDays: MAX_TREND_DAYS,
    title: "reports.report.salesYearly",
    description: "reports.desc.salesYearly",
    build: async (ctx) => {
      const rows = await bucketSales(ctx, "year");
      return finish({
        key: "sales-yearly",
        title: "reports.report.salesYearly",
        period: ctx.period,
        columns: periodColumns("reports.col.year", "text"),
        rows,
        metrics: periodMetrics(rows),
        notes: ["reports.note.netAfterRefunds"],
      });
    },
  },
  {
    key: "sales-hourly",
    family: "sales",
    maxRangeDays: MAX_TREND_DAYS,
    title: "reports.report.salesHourly",
    description: "reports.desc.salesHourly",
    build: async (ctx) => {
      const rows = await bucketSales(ctx, "hour");
      return finish({
        key: "sales-hourly",
        title: "reports.report.salesHourly",
        period: ctx.period,
        columns: periodColumns("reports.col.hour", "text"),
        rows: sortRows(rows, "net", "asc"),
        metrics: periodMetrics(rows),
        notes: ["reports.note.hourlyPeak", "reports.note.netAfterRefunds"],
      });
    },
  },
  {
    key: "sales-by-product",
    family: "sales",
    title: "reports.report.salesByProduct",
    description: "reports.desc.salesByProduct",
    build: async (ctx) => {
      const rows = sortRows(await productTotals(ctx, await windowItems(ctx)), "revenue");
      return finish({
        key: "sales-by-product",
        title: "reports.report.salesByProduct",
        period: ctx.period,
        columns: PRODUCT_COLUMNS,
        rows,
        metrics: [
          { key: "revenue", label: "reports.col.revenue", value: add(...rows.map((r) => num(r.revenue))), type: "money" },
          { key: "quantity", label: "reports.col.qtySold", value: add(...rows.map((r) => num(r.quantity))), type: "quantity" },
          { key: "products", label: "reports.col.products", value: rows.length, type: "number" },
          { key: "discount", label: "reports.col.discount", value: add(...rows.map((r) => num(r.discount))), type: "money" },
        ],
        notes: ["reports.note.lineRevenueExcludesInvoiceDiscount", "reports.note.costIsCurrentPurchasePrice"],
      });
    },
  },
  {
    key: "sales-by-category",
    family: "sales",
    title: "reports.report.salesByCategory",
    description: "reports.desc.salesByCategory",
    build: async (ctx) => {
      const totals = await productTotals(ctx, await windowItems(ctx));
      const categories = await categoryMap(
        ctx.db,
        totals.map((row) => num(row.categoryId))
      );
      const groups = new Map<string, ReportRow>();
      for (const row of totals) {
        const categoryId = row.categoryId === null ? null : num(row.categoryId);
        const key = categoryId === null ? "none" : String(categoryId);
        let group = groups.get(key);
        if (!group) {
          group = { name: categoryId === null ? null : categories.get(categoryId) ?? null, quantity: 0, revenue: 0, discount: 0 };
          groups.set(key, group);
        }
        group.quantity = num(group.quantity) + num(row.quantity);
        group.revenue = add(num(group.revenue), num(row.revenue));
        group.discount = add(num(group.discount), num(row.discount));
      }
      const rows = [...groups.values()];
      const revenue = add(...rows.map((row) => num(row.revenue)));
      for (const row of rows) row.share = pct(num(row.revenue), revenue);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.category", type: "text" },
        { key: "quantity", label: "reports.col.qtySold", type: "quantity", sum: true },
        { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
      ];
      return finish({
        key: "sales-by-category",
        title: "reports.report.salesByCategory",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "revenue"),
        metrics: [
          { key: "revenue", label: "reports.col.revenue", value: revenue, type: "money" },
          { key: "quantity", label: "reports.col.qtySold", value: add(...rows.map((row) => num(row.quantity))), type: "quantity" },
          { key: "categories", label: "reports.col.categories", value: rows.length, type: "number" },
        ],
        notes: ["reports.note.uncategorised", "reports.note.lineRevenueExcludesInvoiceDiscount"],
      });
    },
  },
  {
    key: "sales-by-customer",
    family: "sales",
    title: "reports.report.salesByCustomer",
    description: "reports.desc.salesByCustomer",
    build: async (ctx) => {
      const sales = await windowSales(ctx);
      const rows = groupSales(sales, (sale) => sale.customer?.name ?? "");
      for (const row of rows) row.name = row.name ?? null;
      const walkIn = rows.filter((row) => row.name === null).length;
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.customer", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "subtotal", label: "reports.col.subtotal", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "total", label: "reports.col.total", type: "money", sum: true },
        { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
      ];
      return finish({
        key: "sales-by-customer",
        title: "reports.report.salesByCustomer",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "total"),
        metrics: [
          { key: "total", label: "reports.col.total", value: add(...rows.map((row) => num(row.total))), type: "money" },
          { key: "invoices", label: "reports.col.invoices", value: add(...rows.map((row) => num(row.invoices))), type: "number" },
          { key: "customers", label: "reports.col.customers", value: rows.length - walkIn, type: "number" },
          { key: "walkIn", label: "reports.col.walkInInvoices", value: walkIn, type: "number" },
        ],
        notes: ["reports.note.walkInHasNoCustomer"],
      });
    },
  },
  {
    key: "sales-by-user",
    family: "sales",
    title: "reports.report.salesByUser",
    description: "reports.desc.salesByUser",
    build: async (ctx) => {
      const [sales, users] = await Promise.all([windowSales(ctx), userMap(ctx.db)]);
      const rows = groupSales(sales, (sale) => users.get(sale.cashierId)?.name ?? "");
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.cashier", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "subtotal", label: "reports.col.subtotal", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "total", label: "reports.col.total", type: "money", sum: true },
        { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
      ];
      return finish({
        key: "sales-by-user",
        title: "reports.report.salesByUser",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "total"),
        metrics: [
          { key: "total", label: "reports.col.total", value: add(...rows.map((row) => num(row.total))), type: "money" },
          { key: "invoices", label: "reports.col.invoices", value: add(...rows.map((row) => num(row.invoices))), type: "number" },
          { key: "cashiers", label: "reports.col.cashiers", value: rows.length, type: "number" },
          { key: "discount", label: "reports.col.discount", value: add(...rows.map((row) => num(row.discount))), type: "money" },
        ],
      });
    },
  },
  {
    key: "sales-by-branch",
    family: "sales",
    title: "reports.report.salesByBranch",
    description: "reports.desc.salesByBranch",
    build: async (ctx) => {
      const [sales, stores] = await Promise.all([windowSales(ctx), storeMap(ctx.db)]);
      const rows = groupSales(sales, (sale) => stores.get(sale.storeId)?.name ?? String(sale.storeId));
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.store", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "subtotal", label: "reports.col.subtotal", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "total", label: "reports.col.total", type: "money", sum: true },
        { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
      ];
      return finish({
        key: "sales-by-branch",
        title: "reports.report.salesByBranch",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "total"),
        metrics: [
          { key: "total", label: "reports.col.total", value: add(...rows.map((row) => num(row.total))), type: "money" },
          { key: "invoices", label: "reports.col.invoices", value: add(...rows.map((row) => num(row.invoices))), type: "number" },
          { key: "stores", label: "reports.col.stores", value: rows.length, type: "number" },
        ],
      });
    },
  },
  {
    key: "sales-cash-vs-credit",
    family: "sales",
    title: "reports.report.salesCashVsCredit",
    description: "reports.desc.salesCashVsCredit",
    build: async (ctx) => {
      const sales = await windowSales(ctx);
      let cash = 0;
      let due = 0;
      for (const sale of sales) {
        cash = add(cash, paidOf(sale));
        due = add(due, num(sale.totalAmount) - paidOf(sale));
      }
      const total = add(cash, due);
      const rows: ReportRow[] = [
        {
          bucket: ctx.period.from === ctx.period.to ? ctx.period.from : `${ctx.period.from} → ${ctx.period.to}`,
          invoices: sales.length,
          cash,
          due,
          total,
          cashShare: pct(cash, total),
        },
      ];
      const columns: ReportColumn[] = [
        { key: "bucket", label: "reports.col.period", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number" },
        { key: "cash", label: "reports.col.cashReceived", type: "money", sum: true },
        { key: "due", label: "reports.col.creditOutstanding", type: "money", sum: true },
        { key: "total", label: "reports.col.total", type: "money", sum: true },
        { key: "cashShare", label: "reports.col.cashShare", type: "percent" },
      ];
      return finish({
        key: "sales-cash-vs-credit",
        title: "reports.report.salesCashVsCredit",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "cash", label: "reports.col.cashReceived", value: cash, type: "money" },
          { key: "due", label: "reports.col.creditOutstanding", value: due, type: "money" },
          { key: "total", label: "reports.col.total", value: total, type: "money" },
          { key: "cashShare", label: "reports.col.cashShare", value: pct(cash, total), type: "percent" },
        ],
        notes: ["reports.note.creditIsUnpaidBalanceOfInvoices"],
      });
    },
  },
  {
    key: "sales-discount",
    family: "sales",
    title: "reports.report.salesDiscount",
    description: "reports.desc.salesDiscount",
    build: async (ctx) => {
      const items = await windowItems(ctx);
      const invoiceSales = await ctx.db.sale.findMany({
        where: { ...ctx.storeFilter, createdAt: within(ctx) },
        select: { discountAmount: true },
      });
      const rows = sortRows(await productTotals(ctx, items), "discount");
      for (const row of rows) row.rate = pct(num(row.discount), num(row.gross));
      const lineDiscount = add(...rows.map((row) => num(row.discount)));
      const invoiceDiscount = add(...invoiceSales.map((sale) => num(sale.discountAmount)));
      const gross = add(...rows.map((row) => num(row.gross)));
      const total = add(lineDiscount, invoiceDiscount);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "quantity", label: "reports.col.qtySold", type: "quantity", sum: true },
        { key: "gross", label: "reports.col.grossBeforeDiscount", type: "money", sum: true },
        { key: "discount", label: "reports.col.lineDiscount", type: "money", sum: true },
        { key: "rate", label: "reports.col.discountRate", type: "percent" },
        { key: "revenue", label: "reports.col.netAfterDiscount", type: "money", sum: true },
      ];
      return finish({
        key: "sales-discount",
        title: "reports.report.salesDiscount",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "lineDiscount", label: "reports.col.lineDiscount", value: lineDiscount, type: "money" },
          { key: "invoiceDiscount", label: "reports.col.invoiceDiscount", value: invoiceDiscount, type: "money" },
          { key: "total", label: "reports.col.totalDiscount", value: total, type: "money" },
          { key: "rate", label: "reports.col.discountRate", value: pct(total, gross), type: "percent" },
        ],
        notes: ["reports.note.discountIsNeverAProfit"],
      });
    },
  },
  {
    key: "sales-returns",
    family: "sales",
    title: "reports.report.salesReturns",
    description: "reports.desc.salesReturns",
    build: async (ctx) => {
      const [returns, users, stores, sales] = await Promise.all([
        ctx.db.return.findMany({
          where: { ...ctx.storeFilter, createdAt: within(ctx) },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            storeId: true,
            saleId: true,
            processedById: true,
            reason: true,
            refundAmount: true,
            items: { select: { saleItemId: true, quantity: true, stockQuantity: true, restocked: true } },
          },
        }),
        userMap(ctx.db),
        storeMap(ctx.db),
        windowSales(ctx),
      ]);

      // ReturnItem points at a sale line by id only, so the products a return
      // touched need a two-step lookup: the lines, then the products.
      const saleItems = await ctx.db.saleItem.findMany({
        where: { id: { in: returns.flatMap((entry) => entry.items.map((item) => item.saleItemId)) } },
        select: { id: true, productId: true, quantity: true, stockQuantity: true },
      });
      const lineById = new Map(saleItems.map((line) => [line.id, line]));
      const products = await productMap(
        ctx.db,
        saleItems.map((line) => line.productId)
      );

      const rows: ReportRow[] = returns.map((entry) => {
        const names = entry.items
          .map((item) => products.get(lineById.get(item.saleItemId)?.productId ?? -1)?.name)
          .filter((name): name is string => Boolean(name));
        return {
          date: entry.createdAt.toISOString(),
          reference: `R-${entry.id}`,
          invoice: entry.saleId,
          store: stores.get(entry.storeId)?.name ?? String(entry.storeId),
          processedBy: users.get(entry.processedById)?.name ?? null,
          products: names.join(", ") || null,
          quantity: entry.items.reduce((sum, item) => sum + num(item.stockQuantity), 0),
          restocked: entry.items.filter((item) => item.restocked).reduce((sum, item) => sum + num(item.stockQuantity), 0),
          refund: num(entry.refundAmount),
          reason: entry.reason,
        };
      });

      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "invoice", label: "reports.col.invoice", type: "number" },
        { key: "store", label: "reports.col.store", type: "text" },
        { key: "processedBy", label: "reports.col.processedBy", type: "text" },
        { key: "products", label: "reports.col.products", type: "text" },
        { key: "quantity", label: "reports.col.qty", type: "quantity", sum: true },
        { key: "restocked", label: "reports.col.restocked", type: "quantity", sum: true },
        { key: "refund", label: "reports.col.refund", type: "money", sum: true },
        { key: "reason", label: "reports.col.reason", type: "text" },
      ];

      const refund = add(...rows.map((row) => num(row.refund)));
      const salesTotal = add(...sales.map((sale) => num(sale.totalAmount)));
      return finish({
        key: "sales-returns",
        title: "reports.report.salesReturns",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "refund", label: "reports.col.refund", value: refund, type: "money" },
          { key: "count", label: "reports.col.returns", value: rows.length, type: "number" },
          { key: "quantity", label: "reports.col.qty", value: add(...rows.map((row) => num(row.quantity))), type: "quantity" },
          { key: "restocked", label: "reports.col.restocked", value: add(...rows.map((row) => num(row.restocked))), type: "quantity" },
          { key: "rate", label: "reports.col.returnRate", value: pct(refund, salesTotal), type: "percent" },
        ],
        notes: ["reports.note.refundRateIsAgainstSales", "reports.note.restockedOnlyWhenFlagged"],
      });
    },
  },
  {
    key: "sales-invoice-wise",
    family: "sales",
    title: "reports.report.salesInvoiceWise",
    description: "reports.desc.salesInvoiceWise",
    build: async (ctx) => {
      const sales = await windowSales(ctx);
      const [users, stores, lines] = await Promise.all([
        userMap(ctx.db),
        storeMap(ctx.db),
        ctx.db.saleItem.findMany({
          where: { saleId: { in: sales.map((sale) => sale.id) } },
          select: { saleId: true, productId: true },
        }),
      ]);
      const products = await productMap(
        ctx.db,
        lines.map((line) => line.productId)
      );
      const namesBySale = new Map<number, string[]>();
      for (const line of lines) {
        const name = products.get(line.productId)?.name;
        if (!name) continue;
        const list = namesBySale.get(line.saleId) ?? [];
        list.push(name);
        namesBySale.set(line.saleId, list);
      }

      const rows: ReportRow[] = sales.map((sale) => ({
        invoice: sale.id,
        date: sale.createdAt.toISOString(),
        store: stores.get(sale.storeId)?.name ?? String(sale.storeId),
        cashier: sale.cashierId ? users.get(sale.cashierId)?.name ?? null : null,
        customer: sale.customer?.name ?? null,
        items: sale._count.items,
        products: (namesBySale.get(sale.id) ?? []).join(", "),
        subtotal: num(sale.subtotal),
        discount: num(sale.discountAmount),
        tax: num(sale.taxAmount),
        total: num(sale.totalAmount),
        paid: paidOf(sale),
        refunded: refundedOf(sale),
        methods: sale.payments.map((payment) => payment.method).join(", ") || null,
        status: sale.status,
      }));

      const columns: ReportColumn[] = [
        { key: "invoice", label: "reports.col.invoice", type: "number" },
        { key: "date", label: "reports.col.dateTime", type: "datetime" },
        { key: "store", label: "reports.col.store", type: "text" },
        { key: "cashier", label: "reports.col.cashier", type: "text" },
        { key: "customer", label: "reports.col.customer", type: "text" },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "products", label: "reports.col.products", type: "text" },
        { key: "subtotal", label: "reports.col.subtotal", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "tax", label: "reports.col.tax", type: "money", sum: true },
        { key: "total", label: "reports.col.total", type: "money", sum: true },
        { key: "paid", label: "reports.col.paid", type: "money", sum: true },
        { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
        { key: "methods", label: "reports.col.method", type: "text" },
        { key: "status", label: "reports.col.status", type: "badge" },
      ];

      return finish({
        key: "sales-invoice-wise",
        title: "reports.report.salesInvoiceWise",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "total", label: "reports.col.total", value: add(...rows.map((row) => num(row.total))), type: "money" },
          { key: "invoices", label: "reports.col.invoices", value: rows.length, type: "number" },
          { key: "items", label: "reports.col.items", value: add(...rows.map((row) => num(row.items))), type: "quantity" },
          { key: "refunded", label: "reports.col.refunded", value: add(...rows.map((row) => num(row.refunded))), type: "money" },
          { key: "discount", label: "reports.col.discount", value: add(...rows.map((row) => num(row.discount))), type: "money" },
        ],
        notes: ["reports.detailLimitNote"],
      });
    },
  },
];

/** Re-exported for the dashboard report, which needs the same windowed sales
 *  figures without going through a report key. */
export { windowSales, paidOf, refundedOf };
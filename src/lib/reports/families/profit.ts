import { round2 } from "@/lib/returns";
import { add, finish, num, pct, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { categoryMap, productMap } from "../lookups";
import { bucketKey, type BucketKind } from "../period";
import type { ReportColumn, ReportMetric, ReportRow } from "../types";

/**
 * Profit reports.
 *
 * The honest caveat, which every one of these reports states: this schema has
 * no cost snapshot on a sale line. Cost of goods is therefore the product's
 * CURRENT purchasePrice x quantity sold, which is right for a price that has not
 * moved and wrong by exactly the price change for one that has. The alternative -
 * storing a cost per line - is a schema change, so this is what the reports can
 * say today, and they say it rather than presenting a margin as audited.
 *
 * Profit here is revenue - cost of goods. It is not net profit: rent, salaries
 * and the rest live in Expenditure, which the net-profit report adds, and which
 * is COMPANY-wide (see the Expenditure comment in the schema).
 */

const inWindow = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

type Line = {
  productId: number;
  quantity: number;
  revenue: number;
  discount: number;
  cost: number;
  at: Date;
};

/** Every sale line in the window with its revenue and its current-cost estimate. */
async function windowLines(ctx: ReportContext): Promise<Line[]> {
  const items = await ctx.db.saleItem.findMany({
    where: { sale: { ...ctx.storeFilter, createdAt: inWindow(ctx) } },
    select: {
      productId: true,
      quantity: true,
      discountAmount: true,
      lineTotal: true,
      sale: { select: { createdAt: true } },
    },
  });
  // SaleItem keeps productId as a bare column, so cost comes from a lookup of the
  // product's CURRENT purchasePrice rather than from anything on the line.
  const products = await productMap(
    ctx.db,
    items.map((item) => item.productId)
  );
  return items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    revenue: num(item.lineTotal),
    discount: num(item.discountAmount),
    cost: (products.get(item.productId)?.purchasePrice ?? 0) * item.quantity,
    at: item.sale.createdAt,
  }));
}

/** Refunds and invoice-level discounts, which a line-level profit cannot see. */
async function invoiceAdjustments(ctx: ReportContext) {
  const [returns, sales] = await Promise.all([
    ctx.db.return.aggregate({ where: { ...ctx.storeFilter, createdAt: inWindow(ctx) }, _sum: { refundAmount: true } }),
    ctx.db.sale.aggregate({ where: { ...ctx.storeFilter, createdAt: inWindow(ctx) }, _sum: { discountAmount: true, totalAmount: true } }),
  ]);
  return {
    refunded: num(returns._sum.refundAmount ?? 0),
    invoiceDiscount: num(sales._sum.discountAmount ?? 0),
    invoiceTotal: num(sales._sum.totalAmount ?? 0),
  };
}

/** Expenses settled in the window. Company-wide by design. */
function settledExpenses(ctx: ReportContext) {
  return ctx.db.expenditure.aggregate({
    where: { isActive: true, expenditureDate: inWindow(ctx) },
    _sum: { totalAmount: true, paidAmount: true },
  });
}

/** The gross-profit figures every profit report headlines. */
async function headline(ctx: ReportContext) {
  const [lines, adjustments, expenses] = await Promise.all([windowLines(ctx), invoiceAdjustments(ctx), settledExpenses(ctx)]);
  const revenue = add(...lines.map((line) => line.revenue));
  const cost = add(...lines.map((line) => line.cost));
  const lineDiscount = add(...lines.map((line) => line.discount));
  const expenseTotal = num(expenses._sum.totalAmount ?? 0);
  const paid = num(expenses._sum.paidAmount ?? 0);
  const unpaid = round2(expenseTotal - paid);
  const gross = round2(revenue - cost);
  const afterRefund = round2(gross - adjustments.refunded);
  return {
    lines,
    revenue,
    cost,
    lineDiscount,
    invoiceDiscount: adjustments.invoiceDiscount,
    refunded: adjustments.refunded,
    gross,
    afterRefund,
    margin: pct(gross, revenue),
    expensesPaid: paid,
    expensesUnpaid: unpaid,
    net: round2(afterRefund - paid - adjustments.invoiceDiscount),
    quantity: add(...lines.map((line) => line.quantity)),
    products: new Set(lines.map((line) => line.productId)).size,
  };
}

function profitMetrics(head: Awaited<ReturnType<typeof headline>>): ReportMetric[] {
  return [
    { key: "revenue", label: "reports.col.revenue", value: head.revenue, type: "money" },
    { key: "cost", label: "reports.col.costOfGoods", value: head.cost, type: "money" },
    { key: "gross", label: "reports.col.grossProfit", value: head.gross, type: "money", negative: head.gross < 0 },
    { key: "margin", label: "reports.col.grossMargin", value: head.margin, type: "percent" },
    { key: "refunded", label: "reports.col.refunded", value: head.refunded, type: "money" },
    { key: "net", label: "reports.col.netProfit", value: head.net, type: "money", negative: head.net < 0 },
  ];
}

export const profitReports: ReportDefinition[] = [
  {
    key: "profit-gross",
    family: "profit",
    title: "reports.report.profitGross",
    description: "reports.desc.profitGross",
    build: async (ctx) => {
      const head = await headline(ctx);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.line", type: "key" },
        { key: "amount", label: "reports.col.amount", type: "money" },
      ];
      const rows: ReportRow[] = [
        { name: "reports.profit.revenue", amount: head.revenue },
        { name: "reports.profit.costOfGoods", amount: head.cost },
        { name: "reports.profit.grossProfit", amount: head.gross },
        { name: "reports.profit.refunds", amount: -head.refunded },
        { name: "reports.profit.invoiceDiscounts", amount: -head.invoiceDiscount },
        { name: "reports.profit.expensesPaid", amount: -head.expensesPaid },
        { name: "reports.profit.netProfit", amount: head.net },
      ];
      return finish({
        key: "profit-gross",
        title: "reports.report.profitGross",
        period: ctx.period,
        columns,
        rows,
        metrics: profitMetrics(head),
        notes: ["reports.note.costHasNoSaleSnapshot", "reports.note.expenseIsCompanyWide", "reports.note.profitExcludesUnpaidExpenses"],
      });
    },
  },
  {
    key: "profit-margin",
    family: "profit",
    title: "reports.report.profitMargin",
    description: "reports.desc.profitMargin",
    build: async (ctx) => {
      const head = await headline(ctx);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.line", type: "key" },
        { key: "amount", label: "reports.col.amount", type: "money" },
      ];
      const rows: ReportRow[] = [
        { name: "reports.profit.grossMargin", amount: head.margin },
        { name: "reports.profit.refundsAsPercentOfSales", amount: pct(head.refunded, head.revenue) },
        { name: "reports.profit.discountAsPercentOfSales", amount: pct(head.lineDiscount + head.invoiceDiscount, head.revenue) },
        { name: "reports.profit.expenseAsPercentOfSales", amount: pct(head.expensesPaid, head.revenue) },
        { name: "reports.profit.netMargin", amount: pct(head.net, head.revenue) },
      ];
      return finish({
        key: "profit-margin",
        title: "reports.report.profitMargin",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "amount"),
        metrics: profitMetrics(head),
        notes: ["reports.note.costHasNoSaleSnapshot", "reports.note.marginOnLineRevenue"],
      });
    },
  },
  {
    key: "profit-by-product",
    family: "profit",
    title: "reports.report.profitByProduct",
    description: "reports.desc.profitByProduct",
    build: async (ctx) => {
      const lines = await windowLines(ctx);
      const products = await productMap(
        ctx.db,
        lines.map((line) => line.productId)
      );
      const rows = new Map<number, ReportRow>();
      for (const line of lines) {
        let row = rows.get(line.productId);
        if (!row) {
          row = {
            product: products.get(line.productId)?.name ?? null,
            sku: products.get(line.productId)?.sku ?? null,
            quantity: 0,
            revenue: 0,
            cost: 0,
            profit: 0,
          };
          rows.set(line.productId, row);
        }
        row.quantity = num(row.quantity) + line.quantity;
        row.revenue = add(num(row.revenue), line.revenue);
        row.cost = add(num(row.cost), line.cost);
      }
      for (const row of rows.values()) {
        row.profit = round2(num(row.revenue) - num(row.cost));
        row.margin = pct(num(row.profit), num(row.revenue));
      }
      const grouped = [...rows.values()];
      const columns: ReportColumn[] = [
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "quantity", label: "reports.col.qtySold", type: "quantity", sum: true },
        { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
        { key: "cost", label: "reports.col.costOfGoods", type: "money", sum: true },
        { key: "profit", label: "reports.col.grossProfit", type: "money", sum: true },
        { key: "margin", label: "reports.col.grossMargin", type: "percent" },
      ];
      const lossMakers = grouped.filter((row) => num(row.profit) < 0).length;
      return finish({
        key: "profit-by-product",
        title: "reports.report.profitByProduct",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "profit"),
        metrics: [
          { key: "profit", label: "reports.col.grossProfit", value: add(...grouped.map((row) => num(row.profit))), type: "money" },
          { key: "revenue", label: "reports.col.revenue", value: add(...grouped.map((row) => num(row.revenue))), type: "money" },
          { key: "products", label: "reports.col.products", value: grouped.length, type: "number" },
          { key: "lossMakers", label: "reports.col.productsAtLoss", value: lossMakers, type: "number" },
        ],
        notes: ["reports.note.costHasNoSaleSnapshot"],
      });
    },
  },
  {
    key: "profit-by-category",
    family: "profit",
    title: "reports.report.profitByCategory",
    description: "reports.desc.profitByCategory",
    build: async (ctx) => {
      const lines = await windowLines(ctx);
      const products = await productMap(
        ctx.db,
        lines.map((line) => line.productId)
      );
      const categories = await categoryMap(
        ctx.db,
        [...products.values()].map((product) => product.categoryId ?? -1)
      );
      const groups = new Map<string, ReportRow>();
      for (const line of lines) {
        const categoryId = products.get(line.productId)?.categoryId ?? null;
        const key = categoryId === null ? "none" : String(categoryId);
        let row = groups.get(key);
        if (!row) {
          row = {
            name: categoryId === null ? null : categories.get(categoryId) ?? null,
            quantity: 0,
            revenue: 0,
            cost: 0,
          };
          groups.set(key, row);
        }
        row.quantity = num(row.quantity) + line.quantity;
        row.revenue = add(num(row.revenue), line.revenue);
        row.cost = add(num(row.cost), line.cost);
      }
      const rows = [...groups.values()];
      const revenue = add(...rows.map((row) => num(row.revenue)));
      for (const row of rows) {
        row.profit = round2(num(row.revenue) - num(row.cost));
        row.margin = pct(num(row.profit), num(row.revenue));
        row.share = pct(num(row.revenue), revenue);
      }
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.category", type: "text" },
        { key: "quantity", label: "reports.col.qtySold", type: "quantity", sum: true },
        { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
        { key: "cost", label: "reports.col.costOfGoods", type: "money", sum: true },
        { key: "profit", label: "reports.col.grossProfit", type: "money", sum: true },
        { key: "margin", label: "reports.col.grossMargin", type: "percent" },
        { key: "share", label: "reports.col.share", type: "percent" },
      ];
      return finish({
        key: "profit-by-category",
        title: "reports.report.profitByCategory",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "profit"),
        metrics: [
          { key: "profit", label: "reports.col.grossProfit", value: add(...rows.map((row) => num(row.profit))), type: "money" },
          { key: "revenue", label: "reports.col.revenue", value: revenue, type: "money" },
          { key: "categories", label: "reports.col.categories", value: rows.length, type: "number" },
        ],
        notes: ["reports.note.costHasNoSaleSnapshot", "reports.note.uncategorised"],
      });
    },
  },
  {
    key: "profit-daily",
    family: "profit",
    title: "reports.report.profitDaily",
    description: "reports.desc.profitDaily",
    build: async (ctx) => profitOverTime(ctx, "day", "profit-daily", "reports.report.profitDaily"),
  },
  {
    key: "profit-monthly",
    family: "profit",
    title: "reports.report.profitMonthly",
    description: "reports.desc.profitMonthly",
    build: async (ctx) => profitOverTime(ctx, "month", "profit-monthly", "reports.report.profitMonthly"),
  },
  {
    key: "profit-sales-vs-cost",
    family: "profit",
    title: "reports.report.profitSalesVsCost",
    description: "reports.desc.profitSalesVsCost",
    build: async (ctx) => {
      const head = await headline(ctx);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.line", type: "key" },
        { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
        { key: "cost", label: "reports.col.costOfGoods", type: "money", sum: true },
        { key: "profit", label: "reports.col.grossProfit", type: "money", sum: true },
        { key: "margin", label: "reports.col.grossMargin", type: "percent" },
      ];
      const rows: ReportRow[] = [
        {
          name: "reports.profit.total",
          revenue: head.revenue,
          cost: head.cost,
          profit: head.gross,
          margin: head.margin,
        },
      ];
      return finish({
        key: "profit-sales-vs-cost",
        title: "reports.report.profitSalesVsCost",
        period: ctx.period,
        columns,
        rows,
        metrics: profitMetrics(head),
        notes: ["reports.note.costHasNoSaleSnapshot"],
      });
    },
  },
  {
    key: "profit-discount-impact",
    family: "profit",
    title: "reports.report.profitDiscountImpact",
    description: "reports.desc.profitDiscountImpact",
    build: async (ctx) => {
      const [lines, adjustments] = await Promise.all([windowLines(ctx), invoiceAdjustments(ctx)]);
      const grossAtList = add(...lines.map((line) => add(line.revenue, line.discount)));
      const totalDiscount = add(
        ...lines.map((line) => line.discount),
        adjustments.invoiceDiscount
      );
      const head = await headline(ctx);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.line", type: "key" },
        { key: "amount", label: "reports.col.amount", type: "money" },
      ];
      const rows: ReportRow[] = [
        { name: "reports.profit.salesAtListPrice", amount: grossAtList },
        { name: "reports.profit.lineDiscounts", amount: -add(...lines.map((line) => line.discount)) },
        { name: "reports.profit.invoiceDiscounts", amount: -adjustments.invoiceDiscount },
        { name: "reports.profit.revenueAfterDiscount", amount: head.revenue },
        { name: "reports.profit.grossProfitAfterDiscount", amount: head.gross },
        { name: "reports.profit.grossProfitHadNothingBeenDiscounted", amount: round2(head.gross + totalDiscount) },
      ];
      return finish({
        key: "profit-discount-impact",
        title: "reports.report.profitDiscountImpact",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "discount", label: "reports.col.totalDiscount", value: totalDiscount, type: "money" },
          { key: "rate", label: "reports.col.discountRate", value: pct(totalDiscount, grossAtList), type: "percent" },
          { key: "profit", label: "reports.col.grossProfit", value: head.gross, type: "money", negative: head.gross < 0 },
          { key: "profitImpact", label: "reports.col.profitGivenAway", value: totalDiscount, type: "money" },
        ],
        notes: ["reports.note.discountIsNeverAProfit", "reports.note.costHasNoSaleSnapshot"],
      });
    },
  },
  {
    key: "profit-expense-vs-profit",
    family: "profit",
    title: "reports.report.profitExpenseVsProfit",
    description: "reports.desc.profitExpenseVsProfit",
    build: async (ctx) => {
      const [head, expenses] = await Promise.all([headline(ctx), settledExpenses(ctx)]);
      const paid = head.expensesPaid;
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.line", type: "key" },
        { key: "amount", label: "reports.col.amount", type: "money" },
      ];
      const rows: ReportRow[] = [
        { name: "reports.profit.grossProfitAfterRefunds", amount: head.afterRefund },
        { name: "reports.profit.invoiceDiscounts", amount: -head.invoiceDiscount },
        { name: "reports.profit.expensesPaid", amount: -paid },
        { name: "reports.profit.expensesUnpaid", amount: -head.expensesUnpaid },
        { name: "reports.profit.netProfit", amount: head.net },
      ];
      return finish({
        key: "profit-expense-vs-profit",
        title: "reports.report.profitExpenseVsProfit",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "gross", label: "reports.col.grossProfitAfterRefunds", value: head.afterRefund, type: "money" },
          { key: "expenses", label: "reports.col.expenseTotal", value: num(expenses._sum.totalAmount ?? 0), type: "money" },
          { key: "net", label: "reports.col.netProfit", value: head.net, type: "money", negative: head.net < 0 },
          { key: "coverage", label: "reports.col.expenseCoverage", value: pct(head.afterRefund, paid), type: "percent" },
        ],
        notes: ["reports.note.expenseIsCompanyWide", "reports.note.costHasNoSaleSnapshot"],
      });
    },
  },
  {
    key: "profit-net",
    family: "profit",
    title: "reports.report.profitNet",
    description: "reports.desc.profitNet",
    build: async (ctx) => {
      const head = await headline(ctx);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.line", type: "key" },
        { key: "amount", label: "reports.col.amount", type: "money" },
      ];
      const rows: ReportRow[] = [
        { name: "reports.profit.revenue", amount: head.revenue },
        { name: "reports.profit.costOfGoods", amount: -head.cost },
        { name: "reports.profit.refunds", amount: -head.refunded },
        { name: "reports.profit.invoiceDiscounts", amount: -head.invoiceDiscount },
        { name: "reports.profit.expensesPaid", amount: -head.expensesPaid },
        { name: "reports.profit.netProfit", amount: head.net },
        { name: "reports.profit.netMargin", amount: pct(head.net, head.revenue) },
      ];
      return finish({
        key: "profit-net",
        title: "reports.report.profitNet",
        period: ctx.period,
        columns,
        rows,
        metrics: profitMetrics(head),
        notes: [
          "reports.note.costHasNoSaleSnapshot",
          "reports.note.expenseIsCompanyWide",
          "reports.note.netExcludesUnpaidExpenses",
        ],
      });
    },
  },
];

/** Profit per calendar bucket - the daily and monthly views differ only in the
 *  bucket, so they share one builder rather than two copies of the arithmetic. */
async function profitOverTime(ctx: ReportContext, bucket: BucketKind, key: string, title: string) {
  const [lines, adjustments, vouchers] = await Promise.all([
    windowLines(ctx),
    invoiceAdjustments(ctx),
    ctx.db.expenditure.findMany({
      where: { isActive: true, expenditureDate: inWindow(ctx) },
      select: { expenditureDate: true, paidAmount: true },
    }),
  ]);

  const expenseByBucket = new Map<string, number>();
  for (const voucher of vouchers) {
    const day = bucketKey(voucher.expenditureDate, bucket);
    expenseByBucket.set(day, add(expenseByBucket.get(day) ?? 0, num(voucher.paidAmount)));
  }

  const grouped = new Map<string, ReportRow>();
  for (const line of lines) {
    const day = bucketKey(line.at, bucket);
    let row = grouped.get(day);
    if (!row) {
      row = { bucket: day, quantity: 0, revenue: 0, cost: 0 };
      grouped.set(day, row);
    }
    row.quantity = num(row.quantity) + line.quantity;
    row.revenue = add(num(row.revenue), line.revenue);
    row.cost = add(num(row.cost), line.cost);
  }

  const rows: ReportRow[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, row]) => {
      const expenses = expenseByBucket.get(day) ?? 0;
      const profit = round2(num(row.revenue) - num(row.cost) - expenses);
      return { ...row, expenses, profit, margin: pct(profit, num(row.revenue)) };
    });

  const columns: ReportColumn[] = [
    { key: "bucket", label: bucket === "day" ? "reports.col.date" : "reports.col.month", type: bucket === "day" ? "date" : "text" },
    { key: "quantity", label: "reports.col.qtySold", type: "quantity", sum: true },
    { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
    { key: "cost", label: "reports.col.costOfGoods", type: "money", sum: true },
    { key: "expenses", label: "reports.col.expenses", type: "money", sum: true },
    { key: "profit", label: "reports.col.netProfit", type: "money", sum: true },
    { key: "margin", label: "reports.col.netMargin", type: "percent" },
  ];
  const revenue = add(...rows.map((row) => num(row.revenue)));
  const cost = add(...rows.map((row) => num(row.cost)));
  const expensesPaid = add(...rows.map((row) => num(row.expenses)));
  const profit = round2(revenue - cost - expensesPaid);
  return finish({
    key,
    title,
    period: ctx.period,
    columns,
    rows,
    metrics: [
      { key: "revenue", label: "reports.col.revenue", value: revenue, type: "money" },
      { key: "cost", label: "reports.col.costOfGoods", value: cost, type: "money" },
      { key: "expenses", label: "reports.col.expenses", value: expensesPaid, type: "money" },
      { key: "profit", label: "reports.col.netProfit", value: profit, type: "money", negative: profit < 0 },
      { key: "margin", label: "reports.col.netMargin", value: pct(profit, revenue), type: "percent" },
      { key: "refunds", label: "reports.col.refunded", value: adjustments.refunded, type: "money" },
    ],
    notes: ["reports.note.costHasNoSaleSnapshot", "reports.note.expenseIsCompanyWide", "reports.note.bucketProfitIgnoresRefunds"],
  });
}
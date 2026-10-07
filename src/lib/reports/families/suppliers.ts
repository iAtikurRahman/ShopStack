import { round2 } from "@/lib/returns";
import { add, finish, num, pct, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { productMap, warehouseScope } from "../lookups";
import type { ReportColumn, ReportRow } from "../types";

/**
 * Supplier and purchase reports.
 *
 * Two things about the schema shape these reports:
 *
 * - Purchase has NO storeId. A delivery belongs to a shop through the warehouse
 *   its lines were put away in, and one purchase can span several warehouses -
 *   which is why PurchaseItem carries its own warehouseId and Purchase.warehouseId
 *   is only the primary one. So a store-scoped purchase query has to go through
 *   the items, and the per-store split of a multi-warehouse delivery is reported
 *   per line rather than per voucher.
 * - Purchases are dated by `purchasedAt` (when the goods arrived, editable) and
 *   not `createdAt` (when the row was typed in). Reports use purchasedAt,
 *   because the question is always "what arrived this month".
 *
 * Supplier.dueAmount is a stored running balance, as on Customer.
 */

const inWindow = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

/** Purchase lines in the window, store-scoped through the warehouse. */
function purchaseLines(ctx: ReportContext) {
  return ctx.db.purchaseItem.findMany({
    where: { purchase: { purchasedAt: inWindow(ctx) }, ...warehouseScope(ctx) },
    select: {
      id: true,
      productId: true,
      warehouseId: true,
      quantity: true,
      stockQuantity: true,
      unitCost: true,
      purchase: {
        select: {
          id: true,
          reference: true,
          purchasedAt: true,
          createdAt: true,
          totalCost: true,
          paymentMethod: true,
          supplierId: true,
          supplier: { select: { name: true } },
        },
      },
    },
  });
}

type PurchaseLine = Awaited<ReturnType<typeof purchaseLines>>[number];

/** Voucher totals from their lines, so a multi-warehouse delivery is counted
 *  once rather than once per warehouse it fed. */
function voucherTotals(lines: PurchaseLine[]) {
  const vouchers = new Map<number, { purchasedAt: Date; cost: number; quantity: number; lines: number }>();
  for (const line of lines) {
    let voucher = vouchers.get(line.purchase.id);
    if (!voucher) {
      voucher = { purchasedAt: line.purchase.purchasedAt, cost: 0, quantity: 0, lines: 0 };
      vouchers.set(line.purchase.id, voucher);
    }
    voucher.cost = add(voucher.cost, num(line.unitCost) * num(line.quantity));
    voucher.quantity += num(line.stockQuantity);
    voucher.lines += 1;
  }
  return vouchers;
}

/** Payments made to suppliers in the window. */
function supplierPayments(ctx: ReportContext) {
  return ctx.db.payment.findMany({
    where: { type: "supplier", isActive: true, paymentDate: inWindow(ctx) },
    orderBy: { paymentDate: "desc" },
    select: {
      transactionId: true,
      transactionType: true,
      paymentType: true,
      customerSupplierId: true,
      paymentAmount: true,
      description: true,
      paymentDate: true,
    },
  });
}

export const supplierReports: ReportDefinition[] = [
  {
    key: "purchase-report",
    family: "suppliers",
    title: "reports.report.purchaseReport",
    description: "reports.desc.purchaseReport",
    build: async (ctx) => {
      const lines = await purchaseLines(ctx);
      const totals = voucherTotals(lines);
      const headers = new Map<number, PurchaseLine["purchase"]>();
      for (const line of lines) if (!headers.has(line.purchase.id)) headers.set(line.purchase.id, line.purchase);
      const rows: ReportRow[] = [...totals.entries()].map(([id, total]) => {
        const header = headers.get(id);
        return {
          invoice: id,
          date: total.purchasedAt.toISOString(),
          supplier: header?.supplier.name ?? null,
          reference: header?.reference ?? null,
          method: header?.paymentMethod ?? null,
          lines: total.lines,
          quantity: total.quantity,
          cost: total.cost,
          recordedTotal: num(header?.totalCost ?? 0),
          difference: round2(num(header?.totalCost ?? 0) - total.cost),
        };
      });
      const columns: ReportColumn[] = [
        { key: "invoice", label: "reports.col.purchase", type: "number" },
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "supplier", label: "reports.col.supplier", type: "text" },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "method", label: "reports.col.method", type: "text" },
        { key: "lines", label: "reports.col.lines", type: "number", sum: true },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "cost", label: "reports.col.lineCost", type: "money", sum: true },
        { key: "recordedTotal", label: "reports.col.voucherTotal", type: "money", sum: true },
        { key: "difference", label: "reports.col.unexplained", type: "money", sum: true },
      ];
      const difference = add(...rows.map((row) => num(row.difference)));
      return finish({
        key: "purchase-report",
        title: "reports.report.purchaseReport",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "date"),
        metrics: [
          { key: "cost", label: "reports.col.purchaseCost", value: add(...rows.map((row) => num(row.cost))), type: "money" },
          { key: "vouchers", label: "reports.col.vouchers", value: rows.length, type: "number" },
          { key: "quantity", label: "reports.col.quantity", value: add(...rows.map((row) => num(row.quantity))), type: "quantity" },
          { key: "suppliers", label: "reports.col.suppliers", value: new Set(rows.map((row) => row.supplier)).size, type: "number" },
          { key: "difference", label: "reports.col.unexplained", value: difference, type: "money", negative: difference !== 0 },
        ],
        notes: ["reports.note.purchaseUsesPurchasedAt", "reports.note.voucherTotalIsTyped"],
      });
    },
  },
  {
    key: "purchase-by-supplier",
    family: "suppliers",
    title: "reports.report.purchaseBySupplier",
    description: "reports.desc.purchaseBySupplier",
    build: async (ctx) => {
      const lines = await purchaseLines(ctx);
      // Each supplier counts its own vouchers and lines separately: a voucher can
      // have many lines, and summing line counts as vouchers would overstate it.
      const groups = new Map<string, { row: ReportRow; vouchers: Set<number> }>();
      for (const line of lines) {
        const name = line.purchase.supplier.name;
        let entry = groups.get(name);
        if (!entry) {
          entry = {
            row: { name, supplierId: line.purchase.supplierId, vouchers: 0, lines: 0, quantity: 0, cost: 0 },
            vouchers: new Set<number>(),
          };
          groups.set(name, entry);
        }
        entry.vouchers.add(line.purchase.id);
        entry.row.lines = num(entry.row.lines) + 1;
        entry.row.quantity = num(entry.row.quantity) + num(line.stockQuantity);
        entry.row.cost = add(num(entry.row.cost), num(line.unitCost) * num(line.quantity));
      }
      const grouped: ReportRow[] = [...groups.values()].map(({ row, vouchers }) => {
        row.vouchers = vouchers.size;
        return row;
      });
      const total = add(...grouped.map((row) => num(row.cost)));
      for (const row of grouped) row.share = pct(num(row.cost), total);
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.supplier", type: "text" },
        { key: "vouchers", label: "reports.col.vouchers", type: "number", sum: true },
        { key: "lines", label: "reports.col.lines", type: "number", sum: true },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "cost", label: "reports.col.purchaseCost", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
      ];
      return finish({
        key: "purchase-by-supplier",
        title: "reports.report.purchaseBySupplier",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "cost"),
        metrics: [
          { key: "cost", label: "reports.col.purchaseCost", value: total, type: "money" },
          { key: "suppliers", label: "reports.col.suppliers", value: grouped.length, type: "number" },
          { key: "quantity", label: "reports.col.quantity", value: add(...grouped.map((row) => num(row.quantity))), type: "quantity" },
        ],
      });
    },
  },
  {
    key: "purchase-by-product",
    family: "suppliers",
    title: "reports.report.purchaseByProduct",
    description: "reports.desc.purchaseByProduct",
    build: async (ctx) => {
      const lines = await purchaseLines(ctx);
      const products = await productMap(
        ctx.db,
        lines.map((line) => line.productId)
      );
      const rows = new Map<number, ReportRow>();
      for (const line of lines) {
        let row = rows.get(line.productId);
        if (!row) {
          const product = products.get(line.productId);
          row = {
            product: product?.name ?? null,
            sku: product?.sku ?? null,
            quantity: 0,
            cost: 0,
            vouchers: 0,
            lastUnitCost: 0,
            averageUnitCost: 0,
          };
          rows.set(line.productId, row);
        }
        row.quantity = num(row.quantity) + num(line.stockQuantity);
        row.cost = add(num(row.cost), num(line.unitCost) * num(line.quantity));
        // The lines are not ordered by date here, so the "latest price" is the
        // newest purchase this product appears in - which the price-history
        // report reads properly.
        row.lastUnitCost = num(line.unitCost);
      }
      const grouped = [...rows.values()];
      for (const row of grouped) {
        row.averageUnitCost = num(row.quantity) ? round2(num(row.cost) / num(row.quantity)) : 0;
      }
      const columns: ReportColumn[] = [
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "cost", label: "reports.col.purchaseCost", type: "money", sum: true },
        { key: "averageUnitCost", label: "reports.col.averageUnitCost", type: "money" },
        { key: "lastUnitCost", label: "reports.col.latestUnitCost", type: "money" },
      ];
      return finish({
        key: "purchase-by-product",
        title: "reports.report.purchaseByProduct",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "cost"),
        metrics: [
          { key: "cost", label: "reports.col.purchaseCost", value: add(...grouped.map((row) => num(row.cost))), type: "money" },
          { key: "quantity", label: "reports.col.quantity", value: add(...grouped.map((row) => num(row.quantity))), type: "quantity" },
          { key: "products", label: "reports.col.products", value: grouped.length, type: "number" },
        ],
      });
    },
  },
  {
    key: "purchase-price-history",
    family: "suppliers",
    title: "reports.report.purchasePriceHistory",
    description: "reports.desc.purchasePriceHistory",
    build: async (ctx) => {
      const lines = (await purchaseLines(ctx)).slice().sort((a, b) => a.purchase.purchasedAt.getTime() - b.purchase.purchasedAt.getTime());
      const products = await productMap(
        ctx.db,
        lines.map((line) => line.productId)
      );
      // Walked in date order, remembering the last cost seen for each SKU, so
      // each row can be compared with the purchase before it. (Reading the rows
      // array while building it would throw, and re-scanning it per line would
      // be quadratic.)
      const rows: ReportRow[] = [];
      const lastCostBySku = new Map<string, number>();
      for (const line of lines) {
        const sku = products.get(line.productId)?.sku ?? null;
        const unitCost = num(line.unitCost);
        const previous = sku === null ? undefined : lastCostBySku.get(sku);
        rows.push({
          date: line.purchase.purchasedAt.toISOString(),
          purchase: line.purchase.id,
          supplier: line.purchase.supplier.name,
          product: products.get(line.productId)?.name ?? null,
          sku,
          quantity: num(line.stockQuantity),
          unitCost,
          previousCost: previous ?? null,
          change: previous === undefined ? null : round2(unitCost - previous),
          changeRate: previous ? pct(unitCost - previous, previous) : null,
          currentCatalogPrice: products.get(line.productId)?.purchasePrice ?? null,
        });
        if (sku !== null) lastCostBySku.set(sku, unitCost);
      }
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "purchase", label: "reports.col.purchase", type: "number" },
        { key: "supplier", label: "reports.col.supplier", type: "text" },
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "unitCost", label: "reports.col.unitCost", type: "money" },
        { key: "previousCost", label: "reports.col.previousCost", type: "money" },
        { key: "change", label: "reports.col.change", type: "money" },
        { key: "changeRate", label: "reports.col.changeRate", type: "percent" },
        { key: "currentCatalogPrice", label: "reports.col.catalogPrice", type: "money" },
      ];
      const changes = rows.filter((row) => row.previousCost !== null);
      return finish({
        key: "purchase-price-history",
        title: "reports.report.purchasePriceHistory",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "date"),
        metrics: [
          { key: "lines", label: "reports.col.lines", value: rows.length, type: "number" },
          { key: "changes", label: "reports.col.priceChanges", value: changes.length, type: "number" },
          { key: "products", label: "reports.col.products", value: new Set(rows.map((row) => row.sku)).size, type: "number" },
        ],
        notes: ["reports.note.firstRowHasNoPreviousPrice", "reports.detailLimitNote"],
      });
    },
  },
  {
    key: "purchase-return",
    family: "suppliers",
    title: "reports.report.purchaseReturn",
    description: "reports.desc.purchaseReturn",
    build: async (ctx) => {
      const returns = await ctx.db.supplierReturn.findMany({
        where: { createdAt: inWindow(ctx), ...warehouseScope(ctx) },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          quantity: true,
          stockQuantity: true,
          amount: true,
          reason: true,
          productId: true,
          warehouseId: true,
          supplierId: true,
          supplier: { select: { name: true } },
        },
      });
      const [products, warehouses] = await Promise.all([
        productMap(
          ctx.db,
          returns.map((entry) => entry.productId)
        ),
        ctx.db.warehouse.findMany({ select: { id: true, name: true } }),
      ]);
      const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name]));
      const rows: ReportRow[] = returns.map((entry) => {
        const stockQuantity = num(entry.stockQuantity);
        return {
          date: entry.createdAt.toISOString(),
          reference: `SR-${entry.id}`,
          supplier: entry.supplier.name,
          product: products.get(entry.productId)?.name ?? null,
          sku: products.get(entry.productId)?.sku ?? null,
          warehouse: warehouseById.get(entry.warehouseId) ?? String(entry.warehouseId),
          quantity: -stockQuantity,
          units: stockQuantity,
          credit: num(entry.amount),
          perUnit: stockQuantity ? round2(num(entry.amount) / stockQuantity) : 0,
          reason: entry.reason,
        };
      });
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "supplier", label: "reports.col.supplier", type: "text" },
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "warehouse", label: "reports.col.warehouse", type: "text" },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "units", label: "reports.col.unitsReturned", type: "quantity", sum: true },
        { key: "credit", label: "reports.col.supplierCredit", type: "money", sum: true },
        { key: "perUnit", label: "reports.col.perUnit", type: "money" },
        { key: "reason", label: "reports.col.reason", type: "text" },
      ];
      return finish({
        key: "purchase-return",
        title: "reports.report.purchaseReturn",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "credit", label: "reports.col.supplierCredit", value: add(...rows.map((row) => num(row.credit))), type: "money" },
          { key: "units", label: "reports.col.unitsReturned", value: add(...rows.map((row) => num(row.units))), type: "quantity" },
          { key: "returns", label: "reports.col.returns", value: rows.length, type: "number" },
          { key: "suppliers", label: "reports.col.suppliers", value: new Set(rows.map((row) => row.supplier)).size, type: "number" },
        ],
        notes: ["reports.note.creditIsWhatWasEntered", "reports.note.supplierReturnIsNotTiedToAPurchase"],
      });
    },
  },
  {
    key: "supplier-due",
    family: "suppliers",
    title: "reports.report.supplierDue",
    description: "reports.desc.supplierDue",
    build: async (ctx) => {
      const [suppliers, payments] = await Promise.all([
        ctx.db.supplier.findMany({ select: { id: true, name: true, phone: true, dueAmount: true, isActive: true } }),
        supplierPayments(ctx),
      ]);
      const paidBySupplier = new Map<number, number>();
      for (const payment of payments) {
        paidBySupplier.set(
          payment.customerSupplierId,
          add(paidBySupplier.get(payment.customerSupplierId) ?? 0, num(payment.paymentAmount))
        );
      }
      const rows: ReportRow[] = sortRows(
        suppliers
          .filter((supplier) => supplier.dueAmount > 0)
          .map((supplier) => ({
            id: supplier.id,
            name: supplier.name,
            phone: supplier.phone,
            active: supplier.isActive,
            due: round2(supplier.dueAmount),
            paidInPeriod: paidBySupplier.get(supplier.id) ?? 0,
            afterPayment: round2(supplier.dueAmount - (paidBySupplier.get(supplier.id) ?? 0)),
          })),
        "due"
      );
      const total = add(...rows.map((row) => num(row.due)));
      for (const row of rows) row.share = pct(num(row.due), total);
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.supplier", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "active", label: "reports.col.active", type: "badge" },
        { key: "due", label: "reports.col.due", type: "money", sum: true },
        { key: "paidInPeriod", label: "reports.col.paidInPeriod", type: "money", sum: true },
        { key: "afterPayment", label: "reports.col.dueAfterPayments", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
      ];
      return finish({
        key: "supplier-due",
        title: "reports.report.supplierDue",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "due", label: "reports.col.totalDue", value: total, type: "money" },
          { key: "suppliers", label: "reports.col.suppliersWithDue", value: rows.length, type: "number" },
          {
            key: "paid",
            label: "reports.col.paidInPeriod",
            value: add(...payments.map((payment) => num(payment.paymentAmount))),
            type: "money",
          },
          {
            key: "after",
            label: "reports.col.dueAfterPayments",
            value: add(...rows.map((row) => num(row.afterPayment))),
            type: "money",
          },
        ],
        notes: ["reports.note.dueIsStoredBalance", "reports.note.dueIsNotAgeingBucketed"],
      });
    },
  },
  {
    key: "supplier-payment-history",
    family: "suppliers",
    title: "reports.report.supplierPaymentHistory",
    description: "reports.desc.supplierPaymentHistory",
    build: async (ctx) => {
      const [payments, suppliers] = await Promise.all([
        supplierPayments(ctx),
        ctx.db.supplier.findMany({ select: { id: true, name: true } }),
      ]);
      const nameById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
      const rows: ReportRow[] = payments.map((payment) => ({
        date: payment.paymentDate.toISOString(),
        reference: payment.transactionId,
        supplier: nameById.get(payment.customerSupplierId) ?? null,
        supplierId: payment.customerSupplierId,
        method: payment.paymentType,
        amount: num(payment.paymentAmount),
        description: payment.description,
      }));
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "supplier", label: "reports.col.supplier", type: "text" },
        { key: "method", label: "reports.col.method", type: "text" },
        { key: "amount", label: "reports.col.amount", type: "money", sum: true },
        { key: "description", label: "reports.col.description", type: "text" },
      ];
      return finish({
        key: "supplier-payment-history",
        title: "reports.report.supplierPaymentHistory",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "paid", label: "reports.col.paid", value: add(...payments.map((payment) => num(payment.paymentAmount))), type: "money" },
          { key: "entries", label: "reports.col.entries", value: rows.length, type: "number" },
          { key: "suppliers", label: "reports.col.suppliers", value: new Set(rows.map((row) => row.supplier)).size, type: "number" },
        ],
        notes: ["reports.note.voidedPaymentsAreExcluded"],
      });
    },
  },
];
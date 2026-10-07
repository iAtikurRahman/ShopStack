import { round2 } from "@/lib/returns";
import { add, finish, num, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { categoryMap, productMap, storeMap, warehouseMap, warehouseScope } from "../lookups";
import { bucketKey, type BucketKind } from "../period";
import type { ReportColumn, ReportRow } from "../types";

/**
 * Stock reports.
 *
 * Where the money is:
 *
 * - `WarehouseStock.quantity` is the live figure, moved by the POS, purchases,
 *   returns, supplier returns and transfers. It is the only stock number in the
 *   app, and it is per warehouse.
 * - There is no stock-movement table. A movement is a union of four sources,
 *   which `movements()` reads once so the ledger, the in/out report and the
 *   product history all see the same four the same way.
 * - There is no cost snapshot on a sale line, so value and margin use the
 *   product's current purchasePrice. The reports that do say so.
 */

const inWindow = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

const MOVEMENT_LABELS: Record<MovementKind, string> = {
  purchase: "reports.movement.purchase",
  sale: "reports.movement.sale",
  supplierReturn: "reports.movement.supplierReturn",
  customerReturn: "reports.movement.customerReturn",
  transferIn: "reports.movement.transferIn",
  transferOut: "reports.movement.transferOut",
};

type MovementKind = "purchase" | "sale" | "supplierReturn" | "customerReturn" | "transferIn" | "transferOut";

type Movement = {
  at: Date;
  kind: MovementKind;
  productId: number;
  warehouseId: number;
  /** Positive into stock, negative out of it. */
  quantity: number;
  reference: string;
  note: string | null;
};

/** Every stock movement in the window, from the tables that cause one.
 *
 *  A transfer is an out and an in of the same quantity: netted it would vanish,
 *  and stock that walked from one warehouse to another is a real event in both
 *  warehouses' ledgers. The reports that group by period net them and say so.
 */
async function movements(ctx: ReportContext): Promise<Movement[]> {
  const list: Movement[] = [];
  const [purchases, sales, supplierReturns, transfers] = await Promise.all([
    ctx.db.purchaseItem.findMany({
      where: { purchase: { purchasedAt: inWindow(ctx) }, ...warehouseScope(ctx) },
      select: {
        productId: true,
        warehouseId: true,
        quantity: true,
        stockQuantity: true,
        purchase: { select: { id: true, purchasedAt: true } },
      },
    }),
    ctx.db.saleItem.findMany({
      where: { sale: { ...ctx.storeFilter, createdAt: inWindow(ctx) } },
      select: { productId: true, quantity: true, stockQuantity: true, sale: { select: { id: true, warehouseId: true, createdAt: true } } },
    }),
    ctx.db.supplierReturn.findMany({
      where: { createdAt: inWindow(ctx), ...warehouseScope(ctx) },
      select: { productId: true, warehouseId: true, quantity: true, stockQuantity: true, id: true, createdAt: true, reason: true },
    }),
    ctx.db.stockTransfer.findMany({
      where: { status: "completed", completedAt: inWindow(ctx) },
      select: {
        id: true,
        completedAt: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        items: { select: { productId: true, quantity: true, stockQuantity: true } },
      },
    }),
  ]);

  for (const line of purchases) {
    list.push({
      at: line.purchase.purchasedAt,
      kind: "purchase",
      productId: line.productId,
      warehouseId: line.warehouseId,
      quantity: num(line.stockQuantity),
      reference: `P-${line.purchase.id}`,
      note: null,
    });
  }
  for (const line of sales) {
    list.push({
      at: line.sale.createdAt,
      kind: "sale",
      productId: line.productId,
      warehouseId: line.sale.warehouseId,
      quantity: -num(line.stockQuantity),
      reference: `S-${line.sale.id}`,
      note: null,
    });
  }
  for (const entry of supplierReturns) {
    list.push({
      at: entry.createdAt,
      kind: "supplierReturn",
      productId: entry.productId,
      warehouseId: entry.warehouseId,
      quantity: -num(entry.stockQuantity),
      reference: `SR-${entry.id}`,
      note: entry.reason,
    });
  }
  for (const transfer of transfers) {
    if (!transfer.completedAt) continue;
    for (const item of transfer.items) {
      list.push({
        at: transfer.completedAt,
        kind: "transferOut",
        productId: item.productId,
        warehouseId: transfer.fromWarehouseId,
        quantity: -num(item.stockQuantity),
        reference: `T-${transfer.id}`,
        note: null,
      });
      list.push({
        at: transfer.completedAt,
        kind: "transferIn",
        productId: item.productId,
        warehouseId: transfer.toWarehouseId,
        quantity: num(item.stockQuantity),
        reference: `T-${transfer.id}`,
        note: null,
      });
    }
  }

  return list.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Customer returns that went back on the shelf.
 *
 *  ReturnItem points at a sale line by id only, so this is a two-step lookup:
 *  the sale lines, then the products. A line not flagged `restocked` never
 *  re-entered stock, so it is not a movement - it belongs in the loss report.
 */
async function restockedReturns(ctx: ReportContext): Promise<Movement[]> {
  const entries = await ctx.db.return.findMany({
    where: { ...ctx.storeFilter, createdAt: inWindow(ctx) },
    select: {
      id: true,
      createdAt: true,
      reason: true,
      items: { select: { saleItemId: true, quantity: true, stockQuantity: true, restocked: true } },
    },
  });
  const lines = await ctx.db.saleItem.findMany({
    where: { id: { in: entries.flatMap((entry) => entry.items.map((item) => item.saleItemId)) } },
    // The warehouse is the SALE's, not the line's - SaleItem has no warehouseId.
    select: { id: true, productId: true, sale: { select: { warehouseId: true } } },
  });
  const byId = new Map(lines.map((line) => [line.id, line]));
  return entries.flatMap((entry) =>
    entry.items.flatMap((item) => {
      const line = byId.get(item.saleItemId);
      if (!line || !item.restocked) return [];
      return [
        {
          at: entry.createdAt,
          kind: "customerReturn" as MovementKind,
          productId: line.productId,
warehouseId: line.sale.warehouseId,
          quantity: num(item.stockQuantity),
          reference: `R-${entry.id}`,
          note: entry.reason,
        },
      ];
    })
  );
}

const STOCK_COLUMNS: ReportColumn[] = [
  { key: "product", label: "reports.col.product", type: "text" },
  { key: "sku", label: "reports.col.sku", type: "text" },
  { key: "category", label: "reports.col.category", type: "text" },
  { key: "warehouse", label: "reports.col.warehouse", type: "text" },
  { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
  { key: "threshold", label: "reports.col.threshold", type: "quantity", sum: true },
  { key: "costPrice", label: "reports.col.purchasePrice", type: "money" },
  { key: "salePrice", label: "reports.col.salePrice", type: "money" },
  { key: "costValue", label: "reports.col.costValue", type: "money", sum: true },
  { key: "saleValue", label: "reports.col.saleValue", type: "money", sum: true },
  { key: "status", label: "reports.col.status", type: "badge" },
];

/** Live stock for every warehouse the caller can see. Not period-filtered: the
 *  quantity on hand right now is the same figure whatever period is selected. */
async function stockRows(ctx: ReportContext): Promise<ReportRow[]> {
  const stocks = await ctx.db.warehouseStock.findMany({
    where: warehouseScope(ctx),
    select: {
      productId: true,
      quantity: true,
      lowStockThreshold: true,
      warehouse: { select: { name: true, storeId: true } },
      product: { select: { sku: true, name: true, categoryId: true, purchasePrice: true, salePrice: true } },
    },
  });
  const categories = await categoryMap(
    ctx.db,
    stocks.map((stock) => stock.product.categoryId ?? -1)
  );
  const stores = await storeMap(ctx.db);

  return stocks.map((stock) => {
    const costPrice = num(stock.product.purchasePrice);
    const salePrice = num(stock.product.salePrice);
    const quantity = num(stock.quantity);
    const threshold = num(stock.lowStockThreshold);
    return {
      product: stock.product.name,
      sku: stock.product.sku,
      category: stock.product.categoryId === null ? null : categories.get(stock.product.categoryId) ?? null,
      warehouse: stock.warehouse.name,
      store: stores.get(stock.warehouse.storeId)?.name ?? null,
      quantity,
      threshold,
      costPrice,
      salePrice,
      costValue: round2(costPrice * quantity),
      saleValue: round2(salePrice * quantity),
      status: quantity <= 0 ? "out" : quantity <= threshold ? "low" : "ok",
    };
  });
}

function stockMetrics(rows: ReportRow[], extra: { key: string; label: string; value: number }[] = []) {
  return [
    { key: "lines", label: "reports.col.productLines", value: rows.length, type: "number" as const },
    { key: "units", label: "reports.col.unitsInStock", value: add(...rows.map((row) => num(row.quantity))), type: "quantity" as const },
    { key: "costValue", label: "reports.col.costValue", value: add(...rows.map((row) => num(row.costValue))), type: "money" as const },
    { key: "saleValue", label: "reports.col.saleValue", value: add(...rows.map((row) => num(row.saleValue))), type: "money" as const },
    {
      key: "margin",
      label: "reports.col.potentialMargin",
      value: add(...rows.map((row) => num(row.saleValue) - num(row.costValue))),
      type: "money" as const,
    },
    ...extra.map((metric) => ({ ...metric, type: "number" as const })),
  ];
}

/** Movements rolled into one row per bucket, keeping the per-source split
 *  alongside the totals so a spike can be traced to a kind of movement. */
function bucketMovements(list: Movement[], bucket: BucketKind): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  for (const entry of list) {
    const key = bucketKey(entry.at, bucket);
    let row = rows.get(key);
    if (!row) {
      row = {
        bucket: key,
        in: 0,
        out: 0,
        net: 0,
        purchases: 0,
        sales: 0,
        supplierReturns: 0,
        customerReturns: 0,
        transfers: 0,
      };
      rows.set(key, row);
    }
    if (entry.quantity >= 0) {
      row.in = num(row.in) + entry.quantity;
    } else {
      row.out = num(row.out) + -entry.quantity;
    }
    row.net = num(row.net) + entry.quantity;
    if (entry.kind === "purchase") row.purchases = add(num(row.purchases), entry.quantity);
    if (entry.kind === "sale") row.sales = add(num(row.sales), -entry.quantity);
    if (entry.kind === "supplierReturn") row.supplierReturns = add(num(row.supplierReturns), -entry.quantity);
    if (entry.kind === "customerReturn") row.customerReturns = add(num(row.customerReturns), entry.quantity);
    if (entry.kind === "transferIn" || entry.kind === "transferOut") {
      row.transfers = add(num(row.transfers), Math.abs(entry.quantity));
    }
  }
  return [...rows.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

export const inventoryReports: ReportDefinition[] = [
  {
    key: "stock-current",
    family: "inventory",
    title: "reports.report.stockCurrent",
    description: "reports.desc.stockCurrent",
    build: async (ctx) => {
      const rows = sortRows(await stockRows(ctx), "product", "asc");
      return finish({
        key: "stock-current",
        title: "reports.report.stockCurrent",
        period: ctx.period,
        columns: STOCK_COLUMNS,
        rows,
        metrics: stockMetrics(rows),
        notes: ["reports.note.stockIsLiveNotDated"],
      });
    },
  },
  {
    key: "stock-valuation",
    family: "inventory",
    title: "reports.report.stockValuation",
    description: "reports.desc.stockValuation",
    build: async (ctx) => {
      const rows = await stockRows(ctx);
      const groups = new Map<string, ReportRow>();
      for (const row of rows) {
        const key = row.category === null ? "none" : String(row.category);
        let group = groups.get(key);
        if (!group) {
          group = { name: row.category ?? null, lines: 0, quantity: 0, costValue: 0, saleValue: 0 };
          groups.set(key, group);
        }
        group.lines = num(group.lines) + 1;
        group.quantity = num(group.quantity) + num(row.quantity);
        group.costValue = add(num(group.costValue), num(row.costValue));
        group.saleValue = add(num(group.saleValue), num(row.saleValue));
      }
      const grouped = [...groups.values()];
      for (const group of grouped) group.margin = round2(num(group.saleValue) - num(group.costValue));
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.category", type: "text" },
        { key: "lines", label: "reports.col.productLines", type: "number", sum: true },
        { key: "quantity", label: "reports.col.unitsInStock", type: "quantity", sum: true },
        { key: "costValue", label: "reports.col.costValue", type: "money", sum: true },
        { key: "saleValue", label: "reports.col.saleValue", type: "money", sum: true },
        { key: "margin", label: "reports.col.potentialMargin", type: "money", sum: true },
      ];
      return finish({
        key: "stock-valuation",
        title: "reports.report.stockValuation",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "costValue"),
        metrics: stockMetrics(rows),
        notes: ["reports.note.valuationUsesCurrentPrices", "reports.note.uncategorised"],
      });
    },
  },
  {
    key: "stock-low",
    family: "inventory",
    title: "reports.report.stockLow",
    description: "reports.desc.stockLow",
    build: async (ctx) => {
      const rows = sortRows(
        (await stockRows(ctx)).filter((row) => num(row.quantity) > 0 && num(row.quantity) <= num(row.threshold)),
        "quantity"
      );
      return finish({
        key: "stock-low",
        title: "reports.report.stockLow",
        period: ctx.period,
        columns: STOCK_COLUMNS,
        rows,
        metrics: stockMetrics(rows, [{ key: "below", label: "reports.col.belowThreshold", value: rows.length }]),
        notes: ["reports.note.thresholdIsPerWarehouse"],
      });
    },
  },
  {
    key: "stock-out",
    family: "inventory",
    title: "reports.report.stockOut",
    description: "reports.desc.stockOut",
    build: async (ctx) => {
      const rows = sortRows(
        (await stockRows(ctx)).filter((row) => num(row.quantity) <= 0),
        "product",
        "asc"
      );
      return finish({
        key: "stock-out",
        title: "reports.report.stockOut",
        period: ctx.period,
        columns: STOCK_COLUMNS,
        rows,
        metrics: stockMetrics(rows, [{ key: "out", label: "reports.col.outOfStock", value: rows.length }]),
        notes: ["reports.note.outOfStockCountsZero"],
      });
    },
  },
  {
    key: "stock-in-out",
    family: "inventory",
    title: "reports.report.stockInOut",
    description: "reports.desc.stockInOut",
    build: async (ctx) => {
      const [list, restocks] = await Promise.all([movements(ctx), restockedReturns(ctx)]);
      const all = [...list, ...restocks];
      // A single day of movement is a day-by-day report; anything longer is a
      // month-by-month one, because nobody reads 400 daily rows.
      const bucket: BucketKind = ctx.period.from === ctx.period.to ? "day" : "month";
      const rows = bucketMovements(all, bucket);
      const columns: ReportColumn[] = [
        { key: "bucket", label: bucket === "day" ? "reports.col.date" : "reports.col.month", type: bucket === "day" ? "date" : "text" },
        { key: "in", label: "reports.col.stockIn", type: "quantity", sum: true },
        { key: "out", label: "reports.col.stockOut", type: "quantity", sum: true },
        { key: "net", label: "reports.col.netChange", type: "quantity", sum: true },
        { key: "purchases", label: "reports.col.fromPurchases", type: "quantity", sum: true },
        { key: "sales", label: "reports.col.fromSales", type: "quantity", sum: true },
        { key: "supplierReturns", label: "reports.col.fromSupplierReturns", type: "quantity", sum: true },
        { key: "customerReturns", label: "reports.col.fromCustomerReturns", type: "quantity", sum: true },
        { key: "transfers", label: "reports.col.fromTransfers", type: "quantity", sum: true },
      ];
      return finish({
        key: "stock-in-out",
        title: "reports.report.stockInOut",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "in", label: "reports.col.stockIn", value: add(...rows.map((row) => num(row.in))), type: "quantity" },
          { key: "out", label: "reports.col.stockOut", value: add(...rows.map((row) => num(row.out))), type: "quantity" },
          { key: "net", label: "reports.col.netChange", value: add(...rows.map((row) => num(row.net))), type: "quantity" },
          { key: "movements", label: "reports.col.movements", value: all.length, type: "number" },
        ],
        notes: ["reports.note.transfersNetToZero", "reports.note.movementsExcludeAdjustments"],
      });
    },
  },
  {
    key: "stock-movement",
    family: "inventory",
    title: "reports.report.stockMovement",
    description: "reports.desc.stockMovement",
    build: async (ctx) => {
      const [list, restocks] = await Promise.all([movements(ctx), restockedReturns(ctx)]);
      const all = [...list, ...restocks];
      const [products, warehouses] = await Promise.all([
        productMap(
          ctx.db,
          all.map((entry) => entry.productId)
        ),
        warehouseMap(ctx),
      ]);
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.dateTime", type: "datetime" },
        { key: "type", label: "reports.col.movementType", type: "badge" },
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "warehouse", label: "reports.col.warehouse", type: "text" },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "note", label: "reports.col.note", type: "text" },
      ];
      const rows: ReportRow[] = all
        .slice()
        .reverse()
        .map((entry) => ({
          date: entry.at.toISOString(),
          // The badge renderer resolves this through MOVEMENT_LABELS' counterpart
          // on the client; the raw kind is what the dictionary is keyed by.
          type: MOVEMENT_LABELS[entry.kind],
          product: products.get(entry.productId)?.name ?? null,
          sku: products.get(entry.productId)?.sku ?? null,
          warehouse: warehouses.get(entry.warehouseId)?.name ?? String(entry.warehouseId),
          quantity: entry.quantity,
          reference: entry.reference,
          note: entry.note,
        }));
      return finish({
        key: "stock-movement",
        title: "reports.report.stockMovement",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "movements", label: "reports.col.movements", value: all.length, type: "number" },
          { key: "products", label: "reports.col.products", value: new Set(all.map((entry) => entry.productId)).size, type: "number" },
          { key: "units", label: "reports.col.unitsMoved", value: add(...all.map((entry) => Math.abs(entry.quantity))), type: "quantity" },
        ],
        notes: ["reports.detailLimitNote", "reports.note.transfersAppearTwice"],
      });
    },
  },
  {
    key: "stock-product-history",
    family: "inventory",
    title: "reports.report.stockProductHistory",
    description: "reports.desc.stockProductHistory",
    build: async (ctx) => {
      const [list, restocks] = await Promise.all([movements(ctx), restockedReturns(ctx)]);
      const all = [...list, ...restocks];
      const products = await productMap(
        ctx.db,
        all.map((entry) => entry.productId)
      );
      const rows = new Map<string, ReportRow>();
      for (const entry of all) {
        const key = String(entry.productId);
        let row = rows.get(key);
        if (!row) {
          const product = products.get(entry.productId);
          row = { product: product?.name ?? null, sku: product?.sku ?? null, movements: 0, inQty: 0, outQty: 0, net: 0 };
          rows.set(key, row);
        }
        row.movements = num(row.movements) + 1;
        if (entry.quantity >= 0) row.inQty = num(row.inQty) + entry.quantity;
        else row.outQty = num(row.outQty) - entry.quantity;
        row.net = num(row.net) + entry.quantity;
      }
      const grouped = [...rows.values()];
      const columns: ReportColumn[] = [
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "movements", label: "reports.col.movements", type: "number", sum: true },
        { key: "inQty", label: "reports.col.stockIn", type: "quantity", sum: true },
        { key: "outQty", label: "reports.col.stockOut", type: "quantity", sum: true },
        { key: "net", label: "reports.col.netChange", type: "quantity", sum: true },
      ];
      return finish({
        key: "stock-product-history",
        title: "reports.report.stockProductHistory",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "movements"),
        metrics: [
          { key: "products", label: "reports.col.products", value: grouped.length, type: "number" },
          { key: "inQty", label: "reports.col.stockIn", value: add(...grouped.map((row) => num(row.inQty))), type: "quantity" },
          { key: "outQty", label: "reports.col.stockOut", value: add(...grouped.map((row) => num(row.outQty))), type: "quantity" },
        ],
        notes: ["reports.note.transfersNetToZero"],
      });
    },
  },
  {
    key: "stock-damage-loss",
    family: "inventory",
    title: "reports.report.stockDamageLoss",
    description: "reports.desc.stockDamageLoss",
    build: async (ctx) => {
      const [returns, restocks, supplierReturns, warehouses] = await Promise.all([
        ctx.db.return.findMany({
          where: { ...ctx.storeFilter, createdAt: inWindow(ctx) },
          select: {
            id: true,
            createdAt: true,
            reason: true,
            refundAmount: true,
            items: { select: { saleItemId: true, quantity: true, stockQuantity: true, restocked: true } },
          },
        }),
        restockedReturns(ctx),
        ctx.db.supplierReturn.findMany({
          where: { createdAt: inWindow(ctx), ...warehouseScope(ctx) },
          select: { id: true, productId: true, quantity: true, stockQuantity: true, amount: true, reason: true, createdAt: true, warehouseId: true },
        }),
        warehouseMap(ctx),
      ]);
      // The sale lines a return points at, for the product names.
      const saleLines = await ctx.db.saleItem.findMany({
        where: { id: { in: returns.flatMap((entry) => entry.items.map((item) => item.saleItemId)) } },
        select: { id: true, productId: true },
      });
      const productOfLine = new Map(saleLines.map((line) => [line.id, line.productId]));
      const products = await productMap(ctx.db, [
        ...supplierReturns.map((entry) => entry.productId),
        ...saleLines.map((line) => line.productId),
      ]);

      const rows: ReportRow[] = [];
      for (const entry of supplierReturns) {
        rows.push({
          date: entry.createdAt.toISOString(),
          source: "reports.loss.supplierReturn",
          reference: `SR-${entry.id}`,
          product: products.get(entry.productId)?.name ?? null,
          warehouse: warehouses.get(entry.warehouseId)?.name ?? null,
          quantity: -num(entry.stockQuantity),
          units: num(entry.stockQuantity),
          amount: num(entry.amount),
          reason: entry.reason,
        });
      }
      for (const entry of returns) {
        for (const item of entry.items) {
          if (item.restocked) continue;
          const productId = productOfLine.get(item.saleItemId);
          rows.push({
            date: entry.createdAt.toISOString(),
            source: "reports.loss.customerReturn",
            reference: `R-${entry.id}`,
            product: productId === undefined ? null : products.get(productId)?.name ?? null,
            warehouse: null,
            quantity: -num(item.stockQuantity),
            units: num(item.stockQuantity),
            // Only a supplier return carries a value the supplier agreed to
            // credit. A customer return's money left via refundAmount, which the
            // sales returns report already covers - repeating it here would let
            // the same taka be counted twice across two reports.
            amount: 0,
            reason: entry.reason,
          });
        }
      }

      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "source", label: "reports.col.source", type: "badge" },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "warehouse", label: "reports.col.warehouse", type: "text" },
        { key: "quantity", label: "reports.col.quantity", type: "quantity", sum: true },
        { key: "units", label: "reports.col.unitsLost", type: "quantity", sum: true },
        { key: "amount", label: "reports.col.amount", type: "money", sum: true },
        { key: "reason", label: "reports.col.reason", type: "text" },
      ];

      return finish({
        key: "stock-damage-loss",
        title: "reports.report.stockDamageLoss",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "date"),
        metrics: [
          { key: "units", label: "reports.col.unitsLost", value: add(...rows.map((row) => num(row.units))), type: "quantity" },
          { key: "credit", label: "reports.col.supplierCredit", value: add(...rows.map((row) => num(row.amount))), type: "money" },
          { key: "supplierReturns", label: "reports.col.supplierReturns", value: supplierReturns.length, type: "number" },
          { key: "restocked", label: "reports.col.restocked", value: add(...restocks.map((entry) => entry.quantity)), type: "quantity" },
        ],
        notes: ["reports.note.lossHasNoDamageReasonField", "reports.note.onlySupplierCreditIsValued"],
      });
    },
  },
];
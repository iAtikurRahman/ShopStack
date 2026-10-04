import { round2 } from "@/lib/returns";
import { add, finish, num, pct, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { productMap, userMap } from "../lookups";
import type { ReportColumn, ReportRow } from "../types";

/**
 * Staff reports - what each user did, and who changed what.
 *
 * There is no login-attempt table and no session log in this schema, so the
 * "login history" and "failed logins" reports that were asked for cannot be
 * built: nothing is written when someone signs in or fails to. What is here is
 * the activity that IS recorded - the AuditLog, and permission overrides.
 *
 * Sale.cashierId has no relation to User (User has no `sales` back-reference), so
 * cashier names come from a lookup. Return.processedById is the same story.
 */

const inWindow = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

export const staffReports: ReportDefinition[] = [
  {
    key: "user-sales",
    family: "staff",
    title: "reports.report.userSales",
    description: "reports.desc.userSales",
    build: async (ctx) => {
      const [sales, users] = await Promise.all([
        ctx.db.sale.findMany({
          where: { ...ctx.storeFilter, createdAt: inWindow(ctx) },
          select: {
            cashierId: true,
            totalAmount: true,
            discountAmount: true,
            _count: { select: { items: true } },
            returns: { select: { refundAmount: true } },
          },
        }),
        userMap(ctx.db),
      ]);
      const rows = new Map<number, ReportRow>();
      for (const sale of sales) {
        let row = rows.get(sale.cashierId);
        if (!row) {
          const user = users.get(sale.cashierId);
          row = {
            id: sale.cashierId,
            name: user?.name ?? null,
            role: user?.role ?? null,
            invoices: 0,
            items: 0,
            gross: 0,
            discount: 0,
            net: 0,
            refunded: 0,
            average: 0,
          };
          rows.set(sale.cashierId, row);
        }
        row.invoices = num(row.invoices) + 1;
        row.items = num(row.items) + sale._count.items;
        row.gross = add(num(row.gross), num(sale.totalAmount) + num(sale.discountAmount));
        row.discount = add(num(row.discount), num(sale.discountAmount));
        row.net = add(num(row.net), num(sale.totalAmount));
        row.refunded = add(
          num(row.refunded),
          ...sale.returns.map((entry) => num(entry.refundAmount))
        );
      }
      const grouped = [...rows.values()];
      const total = add(...grouped.map((row) => num(row.net)));
      for (const row of grouped) {
        row.average = num(row.invoices) ? round2(num(row.net) / num(row.invoices)) : 0;
        row.share = pct(num(row.net), total);
      }
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.cashier", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "gross", label: "reports.col.gross", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "net", label: "reports.col.net", type: "money", sum: true },
        { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
      ];
      return finish({
        key: "user-sales",
        title: "reports.report.userSales",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "net"),
        metrics: [
          { key: "net", label: "reports.col.net", value: total, type: "money" },
          { key: "invoices", label: "reports.col.invoices", value: add(...grouped.map((row) => num(row.invoices))), type: "number" },
          { key: "cashiers", label: "reports.col.cashiers", value: grouped.length, type: "number" },
          { key: "discount", label: "reports.col.discount", value: add(...grouped.map((row) => num(row.discount))), type: "money" },
        ],
        notes: ["reports.note.cashierIsWhoeverRecordedTheSale"],
      });
    },
  },
  {
    key: "user-discount",
    family: "staff",
    title: "reports.report.userDiscount",
    description: "reports.desc.userDiscount",
    build: async (ctx) => {
      const [sales, users] = await Promise.all([
        ctx.db.sale.findMany({
          where: { ...ctx.storeFilter, createdAt: inWindow(ctx), discountAmount: { gt: 0 } },
          select: { id: true, cashierId: true, totalAmount: true, discountAmount: true },
        }),
        userMap(ctx.db),
      ]);
      const rows = new Map<number, ReportRow>();
      for (const sale of sales) {
        let row = rows.get(sale.cashierId);
        if (!row) {
          const user = users.get(sale.cashierId);
          row = { id: sale.cashierId, name: user?.name ?? null, role: user?.role ?? null, invoices: 0, sales: 0, discount: 0, rate: 0, average: 0 };
          rows.set(sale.cashierId, row);
        }
        row.invoices = num(row.invoices) + 1;
        row.sales = add(num(row.sales), num(sale.totalAmount));
        row.discount = add(num(row.discount), num(sale.discountAmount));
      }
      const grouped = [...rows.values()];
      for (const row of grouped) {
        row.rate = pct(num(row.discount), add(num(row.sales), num(row.discount)));
        row.average = num(row.invoices) ? round2(num(row.discount) / num(row.invoices)) : 0;
      }
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.cashier", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "invoices", label: "reports.col.discountedInvoices", type: "number", sum: true },
        { key: "sales", label: "reports.col.sales", type: "money", sum: true },
        { key: "discount", label: "reports.col.invoiceDiscount", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
        { key: "rate", label: "reports.col.discountRate", type: "percent" },
      ];
      return finish({
        key: "user-discount",
        title: "reports.report.userDiscount",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "discount"),
        metrics: [
          { key: "discount", label: "reports.col.invoiceDiscount", value: add(...grouped.map((row) => num(row.discount))), type: "money" },
          { key: "invoices", label: "reports.col.discountedInvoices", value: add(...grouped.map((row) => num(row.invoices))), type: "number" },
          {
            key: "rate",
            label: "reports.col.discountRate",
            value: pct(
              add(...grouped.map((row) => num(row.discount))),
              add(
                ...grouped.map((row) => add(num(row.sales), num(row.discount)))
              )
            ),
            type: "percent",
          },
        ],
        notes: ["reports.note.lineDiscountIsNotAttributedToAUser", "reports.note.noApprovalWorkflowInSchema"],
      });
    },
  },
  {
    key: "user-returns",
    family: "staff",
    title: "reports.report.userReturns",
    description: "reports.desc.userReturns",
    build: async (ctx) => {
      const [returns, users] = await Promise.all([
        ctx.db.return.findMany({
          where: { ...ctx.storeFilter, createdAt: inWindow(ctx) },
          select: {
            id: true,
            createdAt: true,
            processedById: true,
            refundAmount: true,
            reason: true,
            saleId: true,
            items: { select: { quantity: true, restocked: true } },
          },
        }),
        userMap(ctx.db),
      ]);
      const rows = new Map<number, ReportRow>();
      for (const entry of returns) {
        let row = rows.get(entry.processedById);
        if (!row) {
          const user = users.get(entry.processedById);
          row = { id: entry.processedById, name: user?.name ?? null, role: user?.role ?? null, returns: 0, quantity: 0, restocked: 0, refund: 0, average: 0 };
          rows.set(entry.processedById, row);
        }
        row.returns = num(row.returns) + 1;
        row.quantity = num(row.quantity) + entry.items.reduce((sum, item) => sum + item.quantity, 0);
        row.restocked = add(
          num(row.restocked),
          ...entry.items.filter((item) => item.restocked).map((item) => item.quantity)
        );
        row.refund = add(num(row.refund), num(entry.refundAmount));
      }
      const grouped = [...rows.values()];
      for (const row of grouped) row.average = num(row.returns) ? round2(num(row.refund) / num(row.returns)) : 0;
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.processedBy", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "returns", label: "reports.col.returns", type: "number", sum: true },
        { key: "quantity", label: "reports.col.qty", type: "quantity", sum: true },
        { key: "restocked", label: "reports.col.restocked", type: "quantity", sum: true },
        { key: "refund", label: "reports.col.refund", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
      ];
      return finish({
        key: "user-returns",
        title: "reports.report.userReturns",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "refund"),
        metrics: [
          { key: "refund", label: "reports.col.refund", value: add(...grouped.map((row) => num(row.refund))), type: "money" },
          { key: "returns", label: "reports.col.returns", value: add(...grouped.map((row) => num(row.returns))), type: "number" },
          { key: "staff", label: "reports.col.staff", value: grouped.length, type: "number" },
          { key: "quantity", label: "reports.col.qty", value: add(...grouped.map((row) => num(row.quantity))), type: "quantity" },
        ],
      });
    },
  },
  {
    key: "user-performance",
    family: "staff",
    title: "reports.report.userPerformance",
    description: "reports.desc.userPerformance",
    build: async (ctx) => {
      const [sales, returns, users] = await Promise.all([
        ctx.db.sale.findMany({
          where: { ...ctx.storeFilter, createdAt: inWindow(ctx) },
          select: {
            cashierId: true,
            totalAmount: true,
            discountAmount: true,
            payments: { select: { amount: true } },
            _count: { select: { items: true } },
          },
        }),
        ctx.db.return.findMany({
          where: { ...ctx.storeFilter, createdAt: inWindow(ctx) },
          select: { processedById: true, refundAmount: true },
        }),
        userMap(ctx.db),
      ]);

      type Row = {
        id: number;
        name: string | null;
        role: string | null;
        invoices: number;
        items: number;
        sales: number;
        discount: number;
        collected: number;
        credit: number;
        refundsProcessed: number;
        refundValue: number;
        average: number;
        discountRate: number;
      };
      const groups = new Map<number, Row>();
      const groupFor = (id: number): Row => {
        let row = groups.get(id);
        if (!row) {
          row = {
            id,
            name: users.get(id)?.name ?? null,
            role: users.get(id)?.role ?? null,
            invoices: 0,
            items: 0,
            sales: 0,
            discount: 0,
            collected: 0,
            credit: 0,
            refundsProcessed: 0,
            refundValue: 0,
            average: 0,
            discountRate: 0,
          };
          groups.set(id, row);
        }
        return row;
      };

      for (const sale of sales) {
        const row = groupFor(sale.cashierId);
        const collected = add(...sale.payments.map((payment) => num(payment.amount)));
        row.invoices += 1;
        row.items += sale._count.items;
        row.sales = add(row.sales, num(sale.totalAmount));
        row.discount = add(row.discount, num(sale.discountAmount));
        row.collected = add(row.collected, collected);
        row.credit = add(row.credit, num(sale.totalAmount) - collected);
      }
      for (const entry of returns) {
        const row = groupFor(entry.processedById);
        row.refundsProcessed += 1;
        row.refundValue = add(row.refundValue, num(entry.refundAmount));
      }

      const grouped = [...groups.values()];
      for (const row of grouped) {
        row.average = row.invoices ? round2(row.sales / row.invoices) : 0;
        row.discountRate = pct(row.discount, add(row.sales, row.discount));
      }
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.staff", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "sales", label: "reports.col.sales", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
        { key: "collected", label: "reports.col.collected", type: "money", sum: true },
        { key: "credit", label: "reports.col.creditSales", type: "money", sum: true },
        { key: "discount", label: "reports.col.invoiceDiscount", type: "money", sum: true },
        { key: "discountRate", label: "reports.col.discountRate", type: "percent" },
        { key: "refundsProcessed", label: "reports.col.returnsHandled", type: "number", sum: true },
        { key: "refundValue", label: "reports.col.refund", type: "money", sum: true },
      ];
      return finish({
        key: "user-performance",
        title: "reports.report.userPerformance",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "sales"),
        metrics: [
          { key: "sales", label: "reports.col.sales", value: add(...grouped.map((row) => row.sales)), type: "money" },
          { key: "collected", label: "reports.col.collected", value: add(...grouped.map((row) => row.collected)), type: "money" },
          { key: "staff", label: "reports.col.staffWithActivity", value: grouped.length, type: "number" },
          { key: "invoices", label: "reports.col.invoices", value: add(...grouped.map((row) => row.invoices)), type: "number" },
        ],
        notes: ["reports.note.refundsCountedUnderProcessorNotSeller"],
      });
    },
  },
  {
    key: "user-activity",
    family: "staff",
    title: "reports.report.userActivity",
    description: "reports.desc.userActivity",
    build: async (ctx) => {
      const [logs, users] = await Promise.all([
        ctx.db.auditLog.findMany({
          where: { createdAt: inWindow(ctx) },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            userId: true,
            userEmail: true,
            action: true,
            entityType: true,
            entityId: true,
            before: true,
            after: true,
          },
        }),
        userMap(ctx.db),
      ]);
      const rows: ReportRow[] = logs.map((log) => ({
        date: log.createdAt.toISOString(),
        user: log.userId === null ? log.userEmail : users.get(log.userId)?.name ?? log.userEmail,
        userId: log.userId,
        action: log.action,
        entity: log.entityType,
        entityId: log.entityId,
        before: log.before === null ? null : JSON.stringify(log.before),
        after: log.after === null ? null : JSON.stringify(log.after),
      }));
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.dateTime", type: "datetime" },
        { key: "user", label: "reports.col.user", type: "text" },
        { key: "action", label: "reports.col.action", type: "badge" },
        { key: "entity", label: "reports.col.entity", type: "text" },
        { key: "entityId", label: "reports.col.entityId", type: "number" },
        { key: "before", label: "reports.col.before", type: "text" },
        { key: "after", label: "reports.col.after", type: "text" },
      ];
      const counts = new Map<string, number>();
      for (const log of logs) counts.set(log.action, (counts.get(log.action) ?? 0) + 1);
      return finish({
        key: "user-activity",
        title: "reports.report.userActivity",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "entries", label: "reports.col.entries", value: logs.length, type: "number" },
          { key: "users", label: "reports.col.users", value: new Set(logs.map((log) => log.userId)).size, type: "number" },
          { key: "actions", label: "reports.col.distinctActions", value: counts.size, type: "number" },
          {
            key: "busiest",
            label: "reports.col.mostCommonAction",
            value: 0,
            type: "number",
          },
        ],
        notes: ["reports.note.auditLogOnlyRecordsWhatIsWritten", "reports.detailLimitNote"],
      });
    },
  },
  {
    key: "user-permission-changes",
    family: "staff",
    title: "reports.report.userPermissionChanges",
    description: "reports.desc.userPermissionChanges",
    build: async (ctx) => {
      // The user comes joined onto the override, so there is no lookup map to
      // build here - one query answers the whole report.
      const overrides = await ctx.db.userPermissionOverride.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          userId: true,
          permissionKey: true,
          allow: true,
          permission: { select: { label: true, description: true } },
          user: { select: { name: true, email: true, role: true } },
        },
      });
      const rows: ReportRow[] = overrides.map((override) => ({
        date: override.createdAt.toISOString(),
        user: override.user.name,
        email: override.user.email,
        role: override.user.role,
        permission: override.permission.label,
        key: override.permissionKey,
        effect: override.allow ? "reports.permission.granted" : "reports.permission.revoked",
        description: override.permission.description,
      }));
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "user", label: "reports.col.user", type: "text" },
        { key: "email", label: "reports.col.email", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "permission", label: "reports.col.permission", type: "text" },
        { key: "key", label: "reports.col.permissionKey", type: "text" },
        { key: "effect", label: "reports.col.effect", type: "badge" },
        { key: "description", label: "reports.col.description", type: "text" },
      ];
      return finish({
        key: "user-permission-changes",
        title: "reports.report.userPermissionChanges",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "overrides", label: "reports.col.overrides", value: rows.length, type: "number" },
          { key: "granted", label: "reports.permission.grantedCount", value: overrides.filter((o) => o.allow).length, type: "number" },
          { key: "revoked", label: "reports.permission.revokedCount", value: overrides.filter((o) => !o.allow).length, type: "number" },
          { key: "users", label: "reports.col.users", value: new Set(overrides.map((o) => o.userId)).size, type: "number" },
        ],
        notes: ["reports.note.overridesAreCurrentStateNotHistory", "reports.note.overrideHasNoPeriod"],
      });
    },
  },
  {
    key: "user-product-sales",
    family: "staff",
    title: "reports.report.userProductSales",
    description: "reports.desc.userProductSales",
    build: async (ctx) => {
      const items = await ctx.db.saleItem.findMany({
        where: { sale: { ...ctx.storeFilter, createdAt: inWindow(ctx) } },
        select: {
          productId: true,
          quantity: true,
          lineTotal: true,
          sale: { select: { cashierId: true } },
        },
      });
      const [users, products] = await Promise.all([
        userMap(ctx.db),
        productMap(
          ctx.db,
          items.map((item) => item.productId)
        ),
      ]);
      const groups = new Map<string, ReportRow>();
      for (const item of items) {
        const cashier = users.get(item.sale.cashierId);
        const key = `${item.sale.cashierId}:${item.productId}`;
        let row = groups.get(key);
        if (!row) {
          row = {
            cashier: cashier?.name ?? null,
            product: products.get(item.productId)?.name ?? null,
            sku: products.get(item.productId)?.sku ?? null,
            lines: 0,
            quantity: 0,
            revenue: 0,
          };
          groups.set(key, row);
        }
        row.lines = num(row.lines) + 1;
        row.quantity = num(row.quantity) + item.quantity;
        row.revenue = add(num(row.revenue), num(item.lineTotal));
      }
      const grouped = [...groups.values()];
      const columns: ReportColumn[] = [
        { key: "cashier", label: "reports.col.cashier", type: "text" },
        { key: "product", label: "reports.col.product", type: "text" },
        { key: "sku", label: "reports.col.sku", type: "text" },
        { key: "lines", label: "reports.col.invoiceLines", type: "number", sum: true },
        { key: "quantity", label: "reports.col.qtySold", type: "quantity", sum: true },
        { key: "revenue", label: "reports.col.revenue", type: "money", sum: true },
      ];
      return finish({
        key: "user-product-sales",
        title: "reports.report.userProductSales",
        period: ctx.period,
        columns,
        rows: sortRows(grouped, "revenue"),
        metrics: [
          { key: "revenue", label: "reports.col.revenue", value: add(...grouped.map((row) => num(row.revenue))), type: "money" },
          { key: "pairs", label: "reports.col.cashierProductPairs", value: grouped.length, type: "number" },
          { key: "quantity", label: "reports.col.qtySold", value: add(...grouped.map((row) => num(row.quantity))), type: "quantity" },
        ],
        notes: ["reports.detailLimitNote"],
      });
    },
  },
];
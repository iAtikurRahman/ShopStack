import { round2 } from "@/lib/returns";
import { add, finish, num, pct, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { bucketKey } from "../period";
import type { ReportColumn, ReportRow } from "../types";

/**
 * Customer reports.
 *
 * Customer.dueAmount and Customer.loyaltyPoints are STORED running figures, not
 * derived: dueAmount moves when a credit sale is booked and when a payment is
 * received, loyaltyPoints moves when a sale is completed. These reports read the
 * stored figure for the balance (there is no ledger to recompute it from that is
 * not the ledger) and the rows for the movement.
 *
 * The ledger is `Payment` with `type = customer`. Its customerSupplierId is a
 * loose int, not a foreign key (see the Payment comment in the schema), so a
 * customer row joined to a deleted customer would be orphaned - the reports join
 * by id and simply show no name where there is none.
 */

const inWindow = (ctx: ReportContext) => ({ gte: ctx.period.start, lt: ctx.period.end });

type SaleRow = {
  id: number;
  createdAt: Date;
  customerId: number | null;
  totalAmount: number;
  discountAmount: number;
  items: number;
  paid: number;
  refunded: number;
};

/** Sales in the window with the per-invoice figures these reports add up. */
async function windowSales(ctx: ReportContext): Promise<Map<number, SaleRow[]>> {
  const sales = await ctx.db.sale.findMany({
    where: { ...ctx.storeFilter, createdAt: inWindow(ctx) },
    select: {
      id: true,
      createdAt: true,
      customerId: true,
      totalAmount: true,
      discountAmount: true,
      _count: { select: { items: true } },
      payments: { select: { amount: true } },
      returns: { select: { refundAmount: true } },
    },
  });
  const byCustomer = new Map<number, SaleRow[]>();
  for (const sale of sales) {
    if (sale.customerId === null) continue;
    const row: SaleRow = {
      id: sale.id,
      createdAt: sale.createdAt,
      customerId: sale.customerId,
      totalAmount: num(sale.totalAmount),
      discountAmount: num(sale.discountAmount),
      items: sale._count.items,
      paid: add(...sale.payments.map((payment) => num(payment.amount))),
      refunded: add(...sale.returns.map((entry) => num(entry.refundAmount))),
    };
    const list = byCustomer.get(sale.customerId) ?? [];
    list.push(row);
    byCustomer.set(sale.customerId, list);
  }
  return byCustomer;
}

type CustomerFacts = {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  loyaltyPoints: number;
  due: number;
  invoices: number;
  items: number;
  spend: number;
  discount: number;
  refunded: number;
  paid: number;
  creditUsed: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
};

/**
 * Every customer, with their sales folded in.
 *
 * Customers with no sale in the window are kept (with zeroes) rather than
 * dropped: a due-receivable report that silently omits the customers who have
 * stopped coming is the one report where an omission is most expensive.
 */
async function customerFacts(ctx: ReportContext): Promise<CustomerFacts[]> {
  const [customers, sales] = await Promise.all([
    ctx.db.customer.findMany({
      select: { id: true, name: true, phone: true, email: true, loyaltyPoints: true, dueAmount: true },
    }),
    windowSales(ctx),
  ]);

  return customers.map((customer) => {
    const own = sales.get(customer.id) ?? [];
    const spend = add(...own.map((sale) => sale.totalAmount));
    const paid = add(...own.map((sale) => sale.paid));
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      loyaltyPoints: customer.loyaltyPoints,
      due: round2(customer.dueAmount),
      invoices: own.length,
      items: add(...own.map((sale) => sale.items)),
      spend,
      discount: add(...own.map((sale) => sale.discountAmount)),
      refunded: add(...own.map((sale) => sale.refunded)),
      paid,
      creditUsed: round2(spend - paid),
      firstPurchase: own.length ? new Date(Math.min(...own.map((sale) => sale.createdAt.getTime()))).toISOString() : null,
      lastPurchase: own.length ? new Date(Math.max(...own.map((sale) => sale.createdAt.getTime()))).toISOString() : null,
    };
  });
}

/** Payments received from customers in the window. */
function customerPayments(ctx: ReportContext) {
  return ctx.db.payment.findMany({
    where: { type: "customer", isActive: true, paymentDate: inWindow(ctx) },
    orderBy: { paymentDate: "desc" },
    select: {
      id: true,
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

export const customerReports: ReportDefinition[] = [
  {
    key: "customer-list",
    family: "customers",
    title: "reports.report.customerList",
    description: "reports.desc.customerList",
    build: async (ctx) => {
      const facts = await customerFacts(ctx);
      const rows: ReportRow[] = facts.map((fact) => ({
        id: fact.id,
        name: fact.name,
        phone: fact.phone,
        email: fact.email,
        invoices: fact.invoices,
        spend: fact.spend,
        due: fact.due,
        loyaltyPoints: fact.loyaltyPoints,
        lastPurchase: fact.lastPurchase,
      }));
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.customer", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "email", label: "reports.col.email", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "spend", label: "reports.col.spend", type: "money", sum: true },
        { key: "due", label: "reports.col.due", type: "money", sum: true },
        { key: "loyaltyPoints", label: "reports.col.loyaltyPoints", type: "number", sum: true },
        { key: "lastPurchase", label: "reports.col.lastPurchase", type: "date" },
      ];
      return finish({
        key: "customer-list",
        title: "reports.report.customerList",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "spend"),
        metrics: [
          { key: "customers", label: "reports.col.customers", value: rows.length, type: "number" },
          { key: "buyers", label: "reports.col.buyers", value: facts.filter((fact) => fact.invoices > 0).length, type: "number" },
          { key: "spend", label: "reports.col.spend", value: add(...facts.map((fact) => fact.spend)), type: "money" },
          { key: "due", label: "reports.col.totalDue", value: add(...facts.map((fact) => fact.due)), type: "money" },
        ],
        notes: ["reports.note.dueIsStoredBalance", "reports.note.customerListIsNotStoreScoped"],
      });
    },
  },
  {
    key: "customer-sales",
    family: "customers",
    title: "reports.report.customerSales",
    description: "reports.desc.customerSales",
    build: async (ctx) => {
      const facts = (await customerFacts(ctx)).filter((fact) => fact.invoices > 0);
      const rows: ReportRow[] = facts.map((fact) => ({
        id: fact.id,
        name: fact.name,
        phone: fact.phone,
        invoices: fact.invoices,
        items: fact.items,
        discount: fact.discount,
        spend: fact.spend,
        refunded: fact.refunded,
        average: fact.invoices ? round2(fact.spend / fact.invoices) : 0,
        firstPurchase: fact.firstPurchase,
        lastPurchase: fact.lastPurchase,
      }));
      const total = add(...rows.map((row) => num(row.spend)));
      for (const row of rows) row.share = pct(num(row.spend), total);
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.customer", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "spend", label: "reports.col.spend", type: "money", sum: true },
        { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
        { key: "firstPurchase", label: "reports.col.firstPurchase", type: "date" },
        { key: "lastPurchase", label: "reports.col.lastPurchase", type: "date" },
      ];
      return finish({
        key: "customer-sales",
        title: "reports.report.customerSales",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "spend"),
        metrics: [
          { key: "spend", label: "reports.col.spend", value: total, type: "money" },
          { key: "customers", label: "reports.col.customers", value: rows.length, type: "number" },
          { key: "invoices", label: "reports.col.invoices", value: add(...rows.map((row) => num(row.invoices))), type: "number" },
          { key: "average", label: "reports.col.average", value: rows.length ? round2(total / rows.length) : 0, type: "money" },
        ],
        notes: ["reports.note.walkInSalesAreExcluded"],
      });
    },
  },
  {
    key: "customer-purchase-history",
    family: "customers",
    title: "reports.report.customerPurchaseHistory",
    description: "reports.desc.customerPurchaseHistory",
    build: async (ctx) => {
      const sales = await windowSales(ctx);
      const customers = await ctx.db.customer.findMany({ select: { id: true, name: true, phone: true } });
      const nameById = new Map(customers.map((customer) => [customer.id, customer]));
      const singleDay = ctx.period.from === ctx.period.to;
      const rows: ReportRow[] = [];
      for (const [customerId, own] of sales) {
        for (const sale of own) {
          rows.push({
            customer: nameById.get(customerId)?.name ?? null,
            phone: nameById.get(customerId)?.phone ?? null,
            bucket: bucketKey(sale.createdAt, singleDay ? "day" : "month"),
            invoice: sale.id,
            date: sale.createdAt.toISOString(),
            items: sale.items,
            total: sale.totalAmount,
            discount: sale.discountAmount,
            paid: sale.paid,
            refunded: sale.refunded,
          });
        }
      }
      const columns: ReportColumn[] = [
        { key: "customer", label: "reports.col.customer", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "bucket", label: singleDay ? "reports.col.date" : "reports.col.month", type: singleDay ? "date" : "text" },
        { key: "invoice", label: "reports.col.invoice", type: "number" },
        { key: "date", label: "reports.col.dateTime", type: "datetime" },
        { key: "items", label: "reports.col.items", type: "quantity", sum: true },
        { key: "total", label: "reports.col.total", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "paid", label: "reports.col.paid", type: "money", sum: true },
        { key: "refunded", label: "reports.col.refunded", type: "money", sum: true },
      ];
      return finish({
        key: "customer-purchase-history",
        title: "reports.report.customerPurchaseHistory",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "date"),
        metrics: [
          { key: "total", label: "reports.col.total", value: add(...rows.map((row) => num(row.total))), type: "money" },
          { key: "invoices", label: "reports.col.invoices", value: rows.length, type: "number" },
          { key: "customers", label: "reports.col.customers", value: sales.size, type: "number" },
        ],
        notes: ["reports.detailLimitNote"],
      });
    },
  },
  {
    key: "customer-top",
    family: "customers",
    title: "reports.report.customerTop",
    description: "reports.desc.customerTop",
    build: async (ctx) => {
      const facts = (await customerFacts(ctx)).filter((fact) => fact.invoices > 0);
      const total = add(...facts.map((fact) => fact.spend));
      const rows: ReportRow[] = facts
        .slice()
        .sort((a, b) => b.spend - a.spend)
        .slice(0, TOP_CUSTOMERS)
        .map((fact, index) => ({
          rank: index + 1,
          name: fact.name,
          phone: fact.phone,
          invoices: fact.invoices,
          spend: fact.spend,
          average: fact.invoices ? round2(fact.spend / fact.invoices) : 0,
          share: pct(fact.spend, total),
          due: fact.due,
        }));
      const columns: ReportColumn[] = [
        { key: "rank", label: "reports.col.rank", type: "number" },
        { key: "name", label: "reports.col.customer", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "spend", label: "reports.col.spend", type: "money", sum: true },
        { key: "average", label: "reports.col.average", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
        { key: "due", label: "reports.col.due", type: "money", sum: true },
      ];
      return finish({
        key: "customer-top",
        title: "reports.report.customerTop",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "listed", label: "reports.col.listed", value: rows.length, type: "number" },
          { key: "spend", label: "reports.col.spend", value: add(...rows.map((row) => num(row.spend))), type: "money" },
          { key: "share", label: "reports.col.shareOfSpend", value: pct(add(...rows.map((row) => num(row.spend))), total), type: "percent" },
          { key: "all", label: "reports.col.allCustomers", value: facts.length, type: "number" },
        ],
        notes: ["reports.note.topIsLimitedToTen"],
      });
    },
  },
  {
    key: "customer-due",
    family: "customers",
    title: "reports.report.customerDue",
    description: "reports.desc.customerDue",
    build: async (ctx) => {
      const [facts, payments] = await Promise.all([customerFacts(ctx), customerPayments(ctx)]);
      const lastPayment = new Map<number, string>();
      for (const payment of payments) {
        const id = payment.customerSupplierId;
        const at = payment.paymentDate.toISOString();
        const existing = lastPayment.get(id);
        if (!existing || at > existing) lastPayment.set(id, at);
      }
      const owing = facts.filter((fact) => fact.due > 0);
      const rows: ReportRow[] = sortRows(
        owing.map((fact) => ({
          id: fact.id,
          name: fact.name,
          phone: fact.phone,
          due: fact.due,
          creditUsed: fact.creditUsed,
          invoices: fact.invoices,
          spend: fact.spend,
          paid: fact.paid,
          lastPayment: lastPayment.get(fact.id) ?? null,
          share: 0,
        })),
        "due"
      );
      const total = add(...rows.map((row) => num(row.due)));
      for (const row of rows) row.share = pct(num(row.due), total);
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.customer", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "due", label: "reports.col.due", type: "money", sum: true },
        { key: "creditUsed", label: "reports.col.creditTakenInPeriod", type: "money", sum: true },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "spend", label: "reports.col.spend", type: "money", sum: true },
        { key: "paid", label: "reports.col.paid", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
        { key: "lastPayment", label: "reports.col.lastPayment", type: "date" },
      ];
      return finish({
        key: "customer-due",
        title: "reports.report.customerDue",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "due", label: "reports.col.totalDue", value: total, type: "money" },
          { key: "customers", label: "reports.col.customersWithDue", value: rows.length, type: "number" },
          { key: "collected", label: "reports.col.receivedInPeriod", value: add(...payments.map((payment) => num(payment.paymentAmount))), type: "money" },
          {
            key: "average",
            label: "reports.col.averageDue",
            value: rows.length ? round2(total / rows.length) : 0,
            type: "money",
          },
        ],
        notes: ["reports.note.dueIsStoredBalance", "reports.note.dueIsNotAgeingBucketed"],
      });
    },
  },
  {
    key: "customer-payment-history",
    family: "customers",
    title: "reports.report.customerPaymentHistory",
    description: "reports.desc.customerPaymentHistory",
    build: async (ctx) => {
      const [payments, customers] = await Promise.all([customerPayments(ctx), ctx.db.customer.findMany({ select: { id: true, name: true } })]);
      const nameById = new Map(customers.map((customer) => [customer.id, customer.name]));
      const rows: ReportRow[] = payments.map((payment) => ({
        date: payment.paymentDate.toISOString(),
        reference: payment.transactionId,
        customer: nameById.get(payment.customerSupplierId) ?? null,
        customerId: payment.customerSupplierId,
        direction: payment.transactionType,
        method: payment.paymentType,
        amount: num(payment.paymentAmount),
        description: payment.description,
      }));
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "customer", label: "reports.col.customer", type: "text" },
        { key: "direction", label: "reports.col.direction", type: "badge" },
        { key: "method", label: "reports.col.method", type: "text" },
        { key: "amount", label: "reports.col.amount", type: "money", sum: true },
        { key: "description", label: "reports.col.description", type: "text" },
      ];
      return finish({
        key: "customer-payment-history",
        title: "reports.report.customerPaymentHistory",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "received", label: "reports.col.received", value: add(...payments.filter((p) => p.transactionType === "receive").map((p) => num(p.paymentAmount))), type: "money" },
          { key: "paid", label: "reports.col.paid", value: add(...payments.filter((p) => p.transactionType === "payment").map((p) => num(p.paymentAmount))), type: "money" },
          { key: "entries", label: "reports.col.entries", value: rows.length, type: "number" },
        ],
        notes: ["reports.note.voidedPaymentsAreExcluded"],
      });
    },
  },
  {
    key: "customer-inactive",
    family: "customers",
    title: "reports.report.customerInactive",
    description: "reports.desc.customerInactive",
    build: async (ctx) => {
      const [facts, lastSales] = await Promise.all([
        customerFacts(ctx),
        // The last sale per customer over ALL time, so "inactive" means dormant
        // rather than "did not buy inside the selected window". A groupBy on the
        // max beats sorting every sale they ever made newest-first.
        ctx.db.sale.groupBy({
          by: ["customerId"],
          where: { customerId: { not: null }, ...ctx.storeFilter },
          _max: { createdAt: true },
        }),
      ]);
      const lastOfAll = new Map<number, string>();
      for (const entry of lastSales) {
        if (entry.customerId === null || !entry._max.createdAt) continue;
        lastOfAll.set(entry.customerId, entry._max.createdAt.toISOString());
      }
      const inactive = facts.filter((fact) => fact.invoices === 0 && lastOfAll.has(fact.id));
      const rows: ReportRow[] = sortRows(
        inactive.map((fact) => ({
          id: fact.id,
          name: fact.name,
          phone: fact.phone,
          due: fact.due,
          lastPurchase: lastOfAll.get(fact.id) ?? null,
        })),
        "due"
      );
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.customer", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "due", label: "reports.col.due", type: "money", sum: true },
        { key: "lastPurchase", label: "reports.col.lastPurchase", type: "date" },
      ];
      return finish({
        key: "customer-inactive",
        title: "reports.report.customerInactive",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "inactive", label: "reports.col.inactiveCustomers", value: rows.length, type: "number" },
          { key: "due", label: "reports.col.totalDue", value: add(...rows.map((row) => num(row.due))), type: "money" },
          { key: "all", label: "reports.col.customers", value: facts.length, type: "number" },
        ],
        notes: ["reports.note.inactiveNeedsNoSalesInPeriod"],
      });
    },
  },
  {
    key: "customer-loyalty",
    family: "customers",
    title: "reports.report.customerLoyalty",
    description: "reports.desc.customerLoyalty",
    build: async (ctx) => {
      const facts = await customerFacts(ctx);
      const rows: ReportRow[] = sortRows(
        facts.map((fact) => ({
          id: fact.id,
          name: fact.name,
          phone: fact.phone,
          loyaltyPoints: fact.loyaltyPoints,
          invoices: fact.invoices,
          spend: fact.spend,
          discount: fact.discount,
          due: fact.due,
          pointsPerInvoice: fact.invoices ? round2(fact.loyaltyPoints / fact.invoices) : 0,
        })),
        "loyaltyPoints"
      );
      const columns: ReportColumn[] = [
        { key: "id", label: "reports.col.id", type: "number" },
        { key: "name", label: "reports.col.customer", type: "text" },
        { key: "phone", label: "reports.col.phone", type: "text" },
        { key: "loyaltyPoints", label: "reports.col.loyaltyPoints", type: "number", sum: true },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "spend", label: "reports.col.spend", type: "money", sum: true },
        { key: "discount", label: "reports.col.discount", type: "money", sum: true },
        { key: "due", label: "reports.col.due", type: "money", sum: true },
        { key: "pointsPerInvoice", label: "reports.col.pointsPerInvoice", type: "number" },
      ];
      return finish({
        key: "customer-loyalty",
        title: "reports.report.customerLoyalty",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "points", label: "reports.col.loyaltyPoints", value: add(...facts.map((fact) => fact.loyaltyPoints)), type: "number" },
          { key: "holders", label: "reports.col.holdingPoints", value: facts.filter((fact) => fact.loyaltyPoints > 0).length, type: "number" },
          { key: "spend", label: "reports.col.spend", value: add(...facts.map((fact) => fact.spend)), type: "money" },
        ],
        notes: ["reports.note.pointsAreStoredNotDerived"],
      });
    },
  },
];

/** How many customers the top list shows. Ten is enough to act on. */
const TOP_CUSTOMERS = 10;
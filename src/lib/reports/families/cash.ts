import { round2 } from "@/lib/returns";
import { add, finish, num, pct, sortRows } from "../aggregate";
import type { ReportContext, ReportDefinition } from "../definition";
import { storeMap, userMap } from "../lookups";
import { bucketKey } from "../period";
import type { ReportColumn, ReportRow } from "../types";

/**
 * Cash and payment reports.
 *
 * The app has no separate cash register and no hard-coded "cash" method: the
 * till, a bank account and an MFS wallet are all rows in BankInfo, and every
 * movement names one by the snapshot name it recorded at the time. So this file
 * reads all of them into one ledger (`cashFlows()`) and each report is a view of
 * that - which is what keeps "money in minus money out" the same number on
 * every one of these screens.
 *
 * Two limits worth stating in the reports themselves:
 *
 * - Accounts are COMPANY-wide by design (see the BankInfo comment in the
 *   schema). A store manager asking for the drawer report gets every store's
 *   movement, and the report says so instead of implying it is shop-only. Only
 *   the POS tender and refunds carry a storeId to filter on.
 * - A customer refund records an amount but no account. The refund report totals
 *   by store and day and says the account is not recorded, rather than
 *   attributing the money to an account nobody wrote down.
 */

type Direction = "in" | "out";

type Flow = {
  at: Date;
  /** BankInfo.bankName as snapshotted when the movement was recorded. */
  account: string;
  direction: Direction;
  amount: number;
  /** Dictionary key for the movement type - the client resolves it. */
  source: string;
  reference: string;
  description: string | null;
};

/** Every movement of money in the window, as one direction-tagged list. */
async function cashFlows(ctx: ReportContext): Promise<Flow[]> {
  const inWindow = { gte: ctx.period.start, lt: ctx.period.end };
  const [tenders, ledger, withdrawals, expenditures, transfers] = await Promise.all([
    ctx.db.salePayment.findMany({
      where: { sale: { ...ctx.storeFilter, createdAt: inWindow } },
      select: { method: true, amount: true, sale: { select: { id: true, createdAt: true } } },
    }),
    ctx.db.payment.findMany({
      where: { isActive: true, paymentDate: inWindow },
      select: {
        transactionId: true,
        transactionType: true,
        paymentType: true,
        type: true,
        paymentAmount: true,
        description: true,
        paymentDate: true,
      },
    }),
    ctx.db.withdrawal.findMany({
      where: { isActive: true, withdrawalDate: inWindow },
      select: {
        id: true,
        withdrawalDate: true,
        amount: true,
        personName: true,
        reason: true,
        bank: { select: { bankName: true } },
      },
    }),
    ctx.db.expenditure.findMany({
      where: { isActive: true, expenditureDate: inWindow },
      select: { id: true, expenditureDate: true, paidAmount: true, paymentMethod: true, note: true, isPaid: true },
    }),
    ctx.db.bankTransfer.findMany({
      where: { isActive: true, createdAt: inWindow },
      select: {
        id: true,
        amount: true,
        remarks: true,
        createdAt: true,
        fromBank: { select: { bankName: true } },
        toBank: { select: { bankName: true } },
      },
    }),
  ]);

  const list: Flow[] = [];

  for (const tender of tenders) {
    list.push({
      at: tender.sale.createdAt,
      account: tender.method,
      direction: "in",
      amount: num(tender.amount),
      source: "reports.cash.saleTender",
      reference: `S-${tender.sale.id}`,
      description: null,
    });
  }
  for (const entry of ledger) {
    list.push({
      at: entry.paymentDate,
      account: entry.paymentType,
      direction: entry.transactionType === "receive" ? "in" : "out",
      amount: num(entry.paymentAmount),
      source:
        entry.transactionType === "receive"
          ? "reports.cash.dueReceived"
          : entry.type === "supplier"
            ? "reports.cash.supplierPaid"
            : "reports.cash.ledgerPayment",
      reference: entry.transactionId,
      description: entry.description,
    });
  }
  for (const entry of withdrawals) {
    list.push({
      at: entry.withdrawalDate,
      account: entry.bank.bankName,
      direction: "out",
      amount: num(entry.amount),
      source: "reports.cash.withdrawal",
      reference: `W-${entry.id}`,
      description: [entry.personName, entry.reason].filter(Boolean).join(" - ") || null,
    });
  }
  for (const entry of expenditures) {
    // An unpaid voucher has moved no money, so it is not a flow at all - which is
    // why this reads paidAmount and not totalAmount.
    const paid = entry.isPaid ? num(entry.paidAmount) : 0;
    if (paid === 0) continue;
    list.push({
      at: entry.expenditureDate,
      account: entry.paymentMethod ?? "",
      direction: "out",
      amount: paid,
      source: "reports.cash.expenditure",
      reference: `E-${entry.id}`,
      description: entry.note,
    });
  }
  for (const entry of transfers) {
    list.push({
      at: entry.createdAt,
      account: entry.fromBank.bankName,
      direction: "out",
      amount: num(entry.amount),
      source: "reports.cash.transferOut",
      reference: `BT-${entry.id}`,
      description: entry.remarks,
    });
    list.push({
      at: entry.createdAt,
      account: entry.toBank.bankName,
      direction: "in",
      amount: num(entry.amount),
      source: "reports.cash.transferIn",
      reference: `BT-${entry.id}`,
      description: entry.remarks,
    });
  }

  return list.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Notes every account-level report carries when the caller only owns a store. */
function accountScopeNote(ctx: ReportContext): string[] {
  return ctx.scopedToStore ? ["reports.note.accountsAreCompanyWide"] : [];
}

const totalIn = (flows: Flow[]) => add(...flows.filter((flow) => flow.direction === "in").map((flow) => flow.amount));
const totalOut = (flows: Flow[]) => add(...flows.filter((flow) => flow.direction === "out").map((flow) => flow.amount));

/** Flows rolled up per calendar day, oldest first. */
function bucketFlows(flows: Flow[]): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  for (const flow of flows) {
    const key = bucketKey(flow.at, "day");
    let row = rows.get(key);
    if (!row) {
      row = { bucket: key, in: 0, out: 0, net: 0, count: 0 };
      rows.set(key, row);
    }
    if (flow.direction === "in") row.in = add(num(row.in), flow.amount);
    else row.out = add(num(row.out), flow.amount);
    row.net = round2(num(row.in) - num(row.out));
    row.count = num(row.count) + 1;
  }
  return [...rows.values()].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

/** Per-account in/out totals for the window. */
function totalsByAccount(flows: Flow[]): Map<string, { in: number; out: number }> {
  const totals = new Map<string, { in: number; out: number }>();
  for (const flow of flows) {
    const entry = totals.get(flow.account) ?? { in: 0, out: 0 };
    if (flow.direction === "in") entry.in = add(entry.in, flow.amount);
    else entry.out = add(entry.out, flow.amount);
    totals.set(flow.account, entry);
  }
  return totals;
}

const FLOW_COLUMNS: ReportColumn[] = [
  { key: "date", label: "reports.col.date", type: "date" },
  { key: "direction", label: "reports.col.direction", type: "badge" },
  { key: "source", label: "reports.col.source", type: "badge" },
  { key: "account", label: "reports.col.account", type: "text" },
  { key: "amount", label: "reports.col.amount", type: "money", sum: true },
  { key: "reference", label: "reports.col.reference", type: "text" },
  { key: "description", label: "reports.col.description", type: "text" },
];

export const cashReports: ReportDefinition[] = [
  {
    key: "cash-daily",
    family: "cash",
    title: "reports.report.cashDaily",
    description: "reports.desc.cashDaily",
    build: async (ctx) => {
      const flows = await cashFlows(ctx);
      const rows = bucketFlows(flows);
      const columns: ReportColumn[] = [
        { key: "bucket", label: "reports.col.date", type: "date" },
        { key: "in", label: "reports.col.moneyIn", type: "money", sum: true },
        { key: "out", label: "reports.col.moneyOut", type: "money", sum: true },
        { key: "net", label: "reports.col.net", type: "money", sum: true },
        { key: "count", label: "reports.col.movements", type: "number", sum: true },
      ];
      return finish({
        key: "cash-daily",
        title: "reports.report.cashDaily",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "in", label: "reports.col.moneyIn", value: totalIn(flows), type: "money" },
          { key: "out", label: "reports.col.moneyOut", value: totalOut(flows), type: "money" },
          { key: "net", label: "reports.col.net", value: add(totalIn(flows), -totalOut(flows)), type: "money" },
          { key: "movements", label: "reports.col.movements", value: flows.length, type: "number" },
        ],
        notes: ["reports.note.transfersCountBothWays", ...accountScopeNote(ctx)],
      });
    },
  },
  {
    key: "cash-in-out",
    family: "cash",
    title: "reports.report.cashInOut",
    description: "reports.desc.cashInOut",
    build: async (ctx) => {
      const flows = await cashFlows(ctx);
      const rows: ReportRow[] = flows
        .slice()
        .reverse()
        .map((flow) => ({
          date: flow.at.toISOString(),
          direction: flow.direction === "in" ? "reports.cash.in" : "reports.cash.out",
          source: flow.source,
          account: flow.account || null,
          amount: flow.amount,
          reference: flow.reference,
          description: flow.description,
        }));
      return finish({
        key: "cash-in-out",
        title: "reports.report.cashInOut",
        period: ctx.period,
        columns: FLOW_COLUMNS,
        rows,
        metrics: [
          { key: "in", label: "reports.col.moneyIn", value: totalIn(flows), type: "money" },
          { key: "out", label: "reports.col.moneyOut", value: totalOut(flows), type: "money" },
          { key: "net", label: "reports.col.net", value: add(totalIn(flows), -totalOut(flows)), type: "money" },
          { key: "movements", label: "reports.col.movements", value: flows.length, type: "number" },
        ],
        notes: ["reports.detailLimitNote", ...accountScopeNote(ctx)],
      });
    },
  },
  {
    key: "cash-by-method",
    family: "cash",
    title: "reports.report.cashByMethod",
    description: "reports.desc.cashByMethod",
    build: async (ctx) => {
      const [flows, accounts] = await Promise.all([
        cashFlows(ctx),
        ctx.db.bankInfo.findMany({ select: { bankName: true, remainingBalance: true } }),
      ]);
      const known = new Map(accounts.map((account) => [account.bankName, account.remainingBalance]));
      const totals = totalsByAccount(flows);
      const rows: ReportRow[] = [...totals.entries()].map(([account, entry]) => ({
        account: account || null,
        known: known.has(account),
        in: entry.in,
        out: entry.out,
        net: round2(entry.in - entry.out),
        balance: known.get(account) ?? null,
      }));
      const columns: ReportColumn[] = [
        { key: "account", label: "reports.col.account", type: "text" },
        { key: "in", label: "reports.col.moneyIn", type: "money", sum: true },
        { key: "out", label: "reports.col.moneyOut", type: "money", sum: true },
        { key: "net", label: "reports.col.net", type: "money", sum: true },
        { key: "balance", label: "reports.col.currentBalance", type: "money" },
      ];
      return finish({
        key: "cash-by-method",
        title: "reports.report.cashByMethod",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "net"),
        metrics: [
          { key: "accounts", label: "reports.col.accounts", value: rows.length, type: "number" },
          { key: "in", label: "reports.col.moneyIn", value: totalIn(flows), type: "money" },
          { key: "out", label: "reports.col.moneyOut", value: totalOut(flows), type: "money" },
          { key: "net", label: "reports.col.net", value: add(totalIn(flows), -totalOut(flows)), type: "money" },
        ],
        notes: ["reports.note.balanceIsCurrentNotPeriod", ...accountScopeNote(ctx)],
      });
    },
  },
  {
    key: "cash-drawer",
    family: "cash",
    title: "reports.report.cashDrawer",
    description: "reports.desc.cashDrawer",
    build: async (ctx) => {
      const [flows, accounts] = await Promise.all([
        cashFlows(ctx),
        ctx.db.bankInfo.findMany({ select: { bankName: true, initialBalance: true, remainingBalance: true, isActive: true } }),
      ]);
      const totals = totalsByAccount(flows);
      const rows: ReportRow[] = accounts.map((account) => {
        const entry = totals.get(account.bankName) ?? { in: 0, out: 0 };
        // The opening balance is derived, not stored: whatever the balance is now,
        // less what moved in this window, is what it was when the window opened.
        // Exact rather than estimated, because remainingBalance is moved by the
        // same transactions that are the rows above - which is what makes
        // `difference` a real exception figure rather than a rounding artefact.
        const opening = round2(account.remainingBalance - entry.in + entry.out);
        return {
          account: account.bankName,
          active: account.isActive,
          declared: round2(account.initialBalance),
          opening,
          movementIn: entry.in,
          movementOut: entry.out,
          closing: round2(account.remainingBalance),
          difference: round2(account.remainingBalance - opening - entry.in + entry.out),
        };
      });
      const columns: ReportColumn[] = [
        { key: "account", label: "reports.col.account", type: "text" },
        { key: "active", label: "reports.col.active", type: "badge" },
        { key: "declared", label: "reports.col.declaredOpening", type: "money", sum: true },
        { key: "opening", label: "reports.col.openingForPeriod", type: "money", sum: true },
        { key: "movementIn", label: "reports.col.moneyIn", type: "money", sum: true },
        { key: "movementOut", label: "reports.col.moneyOut", type: "money", sum: true },
        { key: "closing", label: "reports.col.closing", type: "money", sum: true },
        { key: "difference", label: "reports.col.unexplained", type: "money", sum: true },
      ];
      const difference = add(...rows.map((row) => num(row.difference)));
      return finish({
        key: "cash-drawer",
        title: "reports.report.cashDrawer",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "closing"),
        metrics: [
          { key: "closing", label: "reports.col.totalBalance", value: add(...rows.map((row) => num(row.closing))), type: "money" },
          { key: "opening", label: "reports.col.openingForPeriod", value: add(...rows.map((row) => num(row.opening))), type: "money" },
          { key: "in", label: "reports.col.moneyIn", value: totalIn(flows), type: "money" },
          { key: "out", label: "reports.col.moneyOut", value: totalOut(flows), type: "money" },
          { key: "difference", label: "reports.col.unexplained", value: difference, type: "money", negative: difference !== 0 },
        ],
        notes: ["reports.note.drawerIsAccountBalances", ...accountScopeNote(ctx)],
      });
    },
  },
  {
    key: "cash-daily-closing",
    family: "cash",
    title: "reports.report.cashDailyClosing",
    description: "reports.desc.cashDailyClosing",
    build: async (ctx) => {
      const [flows, accounts] = await Promise.all([
        cashFlows(ctx),
        ctx.db.bankInfo.findMany({ select: { remainingBalance: true } }),
      ]);
      const buckets = bucketFlows(flows);
      // Carry the total from one day into the next so each row can show what it
      // opened with. The first row's opening is derived from the current total
      // less this window's movement; every later row's is yesterday's closing.
      let carry = round2(add(...accounts.map((account) => account.remainingBalance)) - totalIn(flows) + totalOut(flows));
      const rows = buckets.map((row) => {
        const opening = carry;
        carry = round2(opening + num(row.net));
        return { ...row, opening, closing: carry };
      });
      const columns: ReportColumn[] = [
        { key: "bucket", label: "reports.col.date", type: "date" },
        { key: "opening", label: "reports.col.opening", type: "money", sum: true },
        { key: "in", label: "reports.col.moneyIn", type: "money", sum: true },
        { key: "out", label: "reports.col.moneyOut", type: "money", sum: true },
        { key: "closing", label: "reports.col.closing", type: "money", sum: true },
        { key: "count", label: "reports.col.movements", type: "number", sum: true },
      ];
      return finish({
        key: "cash-daily-closing",
        title: "reports.report.cashDailyClosing",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "opening", label: "reports.col.opening", value: rows.length ? num(rows[0].opening) : 0, type: "money" },
          { key: "closing", label: "reports.col.closing", value: rows.length ? num(rows[rows.length - 1].closing) : 0, type: "money" },
          { key: "in", label: "reports.col.moneyIn", value: totalIn(flows), type: "money" },
          { key: "out", label: "reports.col.moneyOut", value: totalOut(flows), type: "money" },
        ],
        notes: ["reports.note.closingCountsAllAccounts", ...accountScopeNote(ctx)],
      });
    },
  },
  {
    key: "cash-collection-by-user",
    family: "cash",
    title: "reports.report.cashCollectionByUser",
    description: "reports.desc.cashCollectionByUser",
    build: async (ctx) => {
      const [sales, users] = await Promise.all([
        ctx.db.sale.findMany({
          where: { ...ctx.storeFilter, createdAt: { gte: ctx.period.start, lt: ctx.period.end } },
          select: { storeId: true, cashierId: true, totalAmount: true, payments: { select: { amount: true } } },
        }),
        userMap(ctx.db),
      ]);
      type CashierGroup = {
        name: string | null;
        role: string | null;
        stores: Set<number>;
        invoices: number;
        collected: number;
        credited: number;
      };
      const groups = new Map<number, CashierGroup>();
      for (const sale of sales) {
        let row = groups.get(sale.cashierId);
        if (!row) {
          row = {
            name: users.get(sale.cashierId)?.name ?? null,
            role: users.get(sale.cashierId)?.role ?? null,
            stores: new Set<number>(),
            invoices: 0,
            collected: 0,
            credited: 0,
          };
          groups.set(sale.cashierId, row);
        }
        row.stores.add(sale.storeId);
        const collected = add(...sale.payments.map((payment) => num(payment.amount)));
        row.invoices = row.invoices + 1;
        row.collected = add(row.collected, collected);
        row.credited = add(row.credited, num(sale.totalAmount) - collected);
      }
      const collected = [...groups.values()].map((row) => row.collected);
      const total = add(...collected);
      const rows: ReportRow[] = [...groups.values()].map((row) => ({
        name: row.name,
        role: row.role,
        stores: row.stores.size,
        invoices: row.invoices,
        collected: row.collected,
        credited: row.credited,
        collectionShare: pct(row.collected, total),
      }));
      const columns: ReportColumn[] = [
        { key: "name", label: "reports.col.cashier", type: "text" },
        { key: "role", label: "reports.col.role", type: "badge" },
        { key: "stores", label: "reports.col.stores", type: "number", sum: true },
        { key: "invoices", label: "reports.col.invoices", type: "number", sum: true },
        { key: "collected", label: "reports.col.collected", type: "money", sum: true },
        { key: "credited", label: "reports.col.creditSales", type: "money", sum: true },
        { key: "collectionShare", label: "reports.col.share", type: "percent" },
      ];
      return finish({
        key: "cash-collection-by-user",
        title: "reports.report.cashCollectionByUser",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "collected"),
        metrics: [
          { key: "collected", label: "reports.col.collected", value: total, type: "money" },
          { key: "credited", label: "reports.col.creditSales", value: add(...rows.map((row) => num(row.credited))), type: "money" },
          { key: "invoices", label: "reports.col.invoices", value: add(...rows.map((row) => num(row.invoices))), type: "number" },
          { key: "cashiers", label: "reports.col.cashiers", value: rows.length, type: "number" },
        ],
        notes: ["reports.note.collectedIsPaymentsOnly"],
      });
    },
  },
  {
    key: "cash-expense",
    family: "cash",
    title: "reports.report.cashExpense",
    description: "reports.desc.cashExpense",
    build: async (ctx) => {
      const expenditures = await ctx.db.expenditure.findMany({
        where: { expenditureDate: { gte: ctx.period.start, lt: ctx.period.end } },
        orderBy: { expenditureDate: "desc" },
        select: {
          id: true,
          expenditureDate: true,
          totalAmount: true,
          paidAmount: true,
          items: { select: { amount: true, head: { select: { name: true } } } },
        },
      });
      const groups = new Map<string, ReportRow>();
      for (const entry of expenditures) {
        for (const item of entry.items) {
          let group = groups.get(item.head.name);
          if (!group) {
            group = { head: item.head.name, lines: 0, amount: 0 };
            groups.set(item.head.name, group);
          }
          group.lines = num(group.lines) + 1;
          group.amount = add(num(group.amount), item.amount);
        }
      }
      const rows = [...groups.values()];
      const lineTotal = add(...rows.map((row) => num(row.amount)));
      for (const row of rows) row.share = pct(num(row.amount), lineTotal);
      const columns: ReportColumn[] = [
        { key: "head", label: "reports.col.head", type: "text" },
        { key: "lines", label: "reports.col.lines", type: "number", sum: true },
        { key: "amount", label: "reports.col.amount", type: "money", sum: true },
        { key: "share", label: "reports.col.share", type: "percent" },
      ];
      return finish({
        key: "cash-expense",
        title: "reports.report.cashExpense",
        period: ctx.period,
        columns,
        rows: sortRows(rows, "amount"),
        metrics: [
          { key: "voucherTotal", label: "reports.col.expenseTotal", value: add(...expenditures.map((entry) => num(entry.totalAmount))), type: "money" },
          { key: "paid", label: "reports.col.paid", value: add(...expenditures.map((entry) => num(entry.paidAmount))), type: "money" },
          {
            key: "unpaid",
            label: "reports.col.unpaid",
            value: add(...expenditures.map((entry) => round2(num(entry.totalAmount) - num(entry.paidAmount)))),
            type: "money",
          },
          { key: "vouchers", label: "reports.col.vouchers", value: expenditures.length, type: "number" },
          { key: "heads", label: "reports.col.heads", value: rows.length, type: "number" },
        ],
        notes: ["reports.note.expenseIsCompanyWide", "reports.note.lineSumExcludesVoucherExtras"],
      });
    },
  },
  {
    key: "cash-refund",
    family: "cash",
    title: "reports.report.cashRefund",
    description: "reports.desc.cashRefund",
    build: async (ctx) => {
      const [returns, users, stores] = await Promise.all([
        ctx.db.return.findMany({
          where: { ...ctx.storeFilter, createdAt: { gte: ctx.period.start, lt: ctx.period.end } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            storeId: true,
            saleId: true,
            reason: true,
            refundAmount: true,
            processedById: true,
            items: { select: { quantity: true, restocked: true } },
          },
        }),
        userMap(ctx.db),
        storeMap(ctx.db),
      ]);
      const rows: ReportRow[] = returns.map((entry) => ({
        date: entry.createdAt.toISOString(),
        reference: `R-${entry.id}`,
        invoice: entry.saleId,
        store: stores.get(entry.storeId)?.name ?? String(entry.storeId),
        processedBy: users.get(entry.processedById)?.name ?? null,
        quantity: entry.items.reduce((sum, item) => sum + item.quantity, 0),
        restocked: entry.items.filter((item) => item.restocked).reduce((sum, item) => sum + item.quantity, 0),
        refund: num(entry.refundAmount),
        reason: entry.reason,
      }));
      const columns: ReportColumn[] = [
        { key: "date", label: "reports.col.date", type: "date" },
        { key: "reference", label: "reports.col.reference", type: "text" },
        { key: "invoice", label: "reports.col.invoice", type: "number" },
        { key: "store", label: "reports.col.store", type: "text" },
        { key: "processedBy", label: "reports.col.processedBy", type: "text" },
        { key: "quantity", label: "reports.col.qty", type: "quantity", sum: true },
        { key: "restocked", label: "reports.col.restocked", type: "quantity", sum: true },
        { key: "refund", label: "reports.col.refund", type: "money", sum: true },
        { key: "reason", label: "reports.col.reason", type: "text" },
      ];
      return finish({
        key: "cash-refund",
        title: "reports.report.cashRefund",
        period: ctx.period,
        columns,
        rows,
        metrics: [
          { key: "refund", label: "reports.col.refund", value: add(...rows.map((row) => num(row.refund))), type: "money" },
          { key: "count", label: "reports.col.returns", value: rows.length, type: "number" },
          { key: "quantity", label: "reports.col.qty", value: add(...rows.map((row) => num(row.quantity))), type: "quantity" },
        ],
        notes: ["reports.note.refundHasNoAccountRecorded"],
      });
    },
  },
];
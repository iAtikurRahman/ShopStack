import type { PrismaClient } from "@/generated/tenant";
import { getBank, type BankRow } from "@/lib/banks";
import { round2 } from "@/lib/returns";

/**
 * The things that can move money in or out of an account. Every one of them
 * ends up calling applyBankDelta, so every one of them belongs on the statement
 * - there is no sixth source to remember when this is extended.
 *
 * A transfer is two kinds rather than one, because one row here is one account's
 * view of a movement: `transferOut` on the account the money left and
 * `transferIn` on the one it reached. Collapsing them into a single kind with a
 * sign would make the type column say "Transfer" on both statements while the
 * amount column disagreed about which way it went.
 */
export type StatementKind =
  | "sale"
  | "receive"
  | "purchase"
  | "payment"
  | "withdrawal"
  | "transferIn"
  | "transferOut";

export type BankStatementRow = {
  /** Stable across renders - "<kind>:<sourceId>", since ids repeat across tables. */
  key: string;
  kind: StatementKind;
  /** When the money moved. The editable business date, not the insert timestamp. */
  date: string;
  /** The row this came from, so the client can print "Sale #12" in any language. */
  sourceId: number;
  /** Who the movement was with - a customer, a supplier, or whoever took the withdrawal. */
  party: string | null;
  /** The owner's own reference (an invoice no, a receipt no). */
  reference: string | null;
  /** Free text that came with the row (a withdrawal reason, a payment description). */
  detail: string | null;
  /** Signed: positive is money in, negative is money out. */
  amount: number;
  /** The figure after this row - what the account held once it had been booked. */
  balance: number;
  /**
   * A movement that was undone. The amount is already reversed, so this reads as
   * the correction it was rather than as the original posting.
   */
  isVoided: boolean;
};

export type BankStatement = {
  bank: BankRow;
  openingBalance: number;
  /** Newest first. */
  rows: BankStatementRow[];
  totalIn: number;
  totalOut: number;
  /**
   * openingBalance + totalIn - totalOut - what the recorded movements add up to.
   *
   * Deliberately kept separate from `bank.remainingBalance`, which is a stored
   * running figure the owner can overwrite by hand (see the Banks screen: a
   * recount). Whenever the two disagree, the difference is an adjustment the
   * owner made, and saying so is the whole point of showing the statement -
   * see `isAdjusted`.
   */
  ledgerBalance: number;
  /** True when the movements and the stored balance do not add up. */
  isAdjusted: boolean;
  voidedCount: number;
};

/**
 * Fixed ordering for movements that land on the exact same millisecond, so the
 * running balance never reshuffles between two renders of the same data.
 * Without this the order would follow whatever order the four queries happened
 * to return, and two movements would swap places - which reads as the balance
 * changing on its own.
 */
const KIND_ORDER: Record<StatementKind, number> = {
  receive: 0,
  sale: 1,
  purchase: 2,
  payment: 3,
  transferIn: 4,
  transferOut: 5,
  withdrawal: 6,
};

/** Prisma hands Decimal columns back as strings; this is the only place that knows. */
function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? round2(parsed) : 0;
}

/**
 * Payment.customerSupplierId is a loose int qualified by `type`, not a foreign
 * key, so the names cannot come back with the row. Two `in` queries cover
 * every payment on the statement rather than one lookup per row.
 */
async function loadPartyNames(
  db: PrismaClient,
  payments: { type: "customer" | "supplier"; customerSupplierId: number }[]
): Promise<Map<string, string>> {
  const customerIds = payments
    .filter((p) => p.type === "customer")
    .map((p) => p.customerSupplierId);
  const supplierIds = payments
    .filter((p) => p.type === "supplier")
    .map((p) => p.customerSupplierId);

  const [customers, suppliers] = await Promise.all([
    // `in: []` is a valid Prisma filter that matches nothing, so a statement
    // with payments on one side only still runs a single well-formed query.
    customerIds.length > 0
      ? db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : [],
    supplierIds.length > 0
      ? db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } })
      : [],
  ]);

  const names = new Map<string, string>();
  for (const customer of customers) names.set(`customer:${customer.id}`, customer.name);
  for (const supplier of suppliers) names.set(`supplier:${supplier.id}`, supplier.name);
  return names;
}

/**
 * Builds the account statement for one bank: every movement that named it, in
 * date order, with a running balance carried forward from the opening figure.
 *
 * The six sources are read in parallel because none of them depends on another,
 * and the merge happens here rather than in the database - MySQL cannot union
 * six differently-shaped tables without a view, and a view would freeze the
 * current schema shape into the database.
 *
 * Sale refunds are deliberately absent. A Return records stock going back and
 * money leaving the customer, but it never calls applyBankDelta, so it has
 * never moved this account's balance - listing it here would show a movement
 * that did not happen.
 *
 * A bank transfer appears here twice across the app's history - as a
 * `transferOut` on one account and a `transferIn` on the other - but exactly once
 * per statement, because each side is fetched by its own foreign key.
 */
export async function getBankStatement(db: PrismaClient, bankId: number): Promise<BankStatement> {
  const bank = await getBank(db, bankId);

  const [salePayments, purchases, payments, withdrawals, transfersOut, transfersIn] = await Promise.all([
    // Money in: the tender on a POS sale. A `due` sale writes no SalePayment at
    // all, so every row here genuinely moved cash into this account.
    db.salePayment.findMany({
      where: { method: bank.bankName },
      select: {
        id: true,
        amount: true,
        saleId: true,
        sale: { select: { createdAt: true, customer: { select: { name: true } } } },
      },
    }),
    // Money out: a delivery settled through this account. `due` rows are
    // excluded by the filter, because `due` is not a bank name.
    db.purchase.findMany({
      where: { paymentMethod: bank.bankName },
      select: {
        id: true,
        totalCost: true,
        purchasedAt: true,
        reference: true,
        supplier: { select: { name: true } },
      },
    }),
    // Money in from a customer (`receive`) or out to a supplier (`payment`).
    // Voided rows are included with the sign flipped, so the statement shows the
    // correction that actually happened rather than hiding it.
    db.payment.findMany({
      where: { paymentType: bank.bankName },
      select: {
        id: true,
        transactionId: true,
        transactionType: true,
        type: true,
        customerSupplierId: true,
        paymentDate: true,
        paymentAmount: true,
        description: true,
        isActive: true,
      },
    }),
    // A real foreign key, so this one is matched on the id rather than the name.
    db.withdrawal.findMany({
      where: { bankId: bank.id },
      select: {
        id: true,
        withdrawalDate: true,
        personName: true,
        accountOrMobile: true,
        amount: true,
        reason: true,
        isActive: true,
      },
    }),
    // A transfer names two accounts, so this one can be on the statement twice
    // over the app's lifetime - once as the account it left, once as the one it
    // reached. Only the half that involves THIS account is fetched, which is
    // what keeps the other account's name out of the row entirely rather than
    // relying on the client to hide it.
    db.bankTransfer.findMany({
      where: { fromBankId: bank.id },
      select: {
        id: true,
        toBankId: true,
        amount: true,
        remarks: true,
        isActive: true,
        createdAt: true,
        toBank: { select: { bankName: true } },
      },
    }),
    db.bankTransfer.findMany({
      where: { toBankId: bank.id },
      select: {
        id: true,
        fromBankId: true,
        amount: true,
        remarks: true,
        isActive: true,
        createdAt: true,
        fromBank: { select: { bankName: true } },
      },
    }),
  ]);

  const partyNames = await loadPartyNames(db, payments);

  type Draft = Omit<BankStatementRow, "balance"> & { at: number; order: number };
  const drafts: Draft[] = [];

  for (const sale of salePayments) {
    drafts.push({
      key: `sale:${sale.id}`,
      kind: "sale",
      at: sale.sale.createdAt.getTime(),
      order: sale.id,
      date: sale.sale.createdAt.toISOString(),
      sourceId: sale.saleId,
      party: sale.sale.customer?.name ?? null,
      reference: null,
      detail: null,
      amount: toAmount(sale.amount),
      isVoided: false,
    });
  }

  for (const purchase of purchases) {
    drafts.push({
      key: `purchase:${purchase.id}`,
      kind: "purchase",
      at: purchase.purchasedAt.getTime(),
      order: purchase.id,
      date: purchase.purchasedAt.toISOString(),
      sourceId: purchase.id,
      party: purchase.supplier.name,
      reference: purchase.reference,
      detail: null,
      amount: -toAmount(purchase.totalCost),
      isVoided: false,
    });
  }

  for (const payment of payments) {
    // A voided payment had its posting undone, so what the account saw was the
    // reverse. Same amount, opposite sign - that is the correction.
    const direction = payment.transactionType === "receive" ? 1 : -1;
    const sign = payment.isActive ? direction : -direction;
    drafts.push({
      key: `payment:${payment.id}`,
      kind: direction === 1 ? "receive" : "payment",
      at: payment.paymentDate.getTime(),
      order: payment.id,
      date: payment.paymentDate.toISOString(),
      sourceId: payment.id,
      party: partyNames.get(`${payment.type}:${payment.customerSupplierId}`) ?? null,
      reference: payment.transactionId,
      detail: payment.description,
      amount: round2(toAmount(payment.paymentAmount) * sign),
      isVoided: !payment.isActive,
    });
  }

  for (const withdrawal of withdrawals) {
    // Voiding a withdrawal puts the amount back on the account, so a voided
    // slip reads as money coming in.
    drafts.push({
      key: `withdrawal:${withdrawal.id}`,
      kind: "withdrawal",
      at: withdrawal.withdrawalDate.getTime(),
      order: withdrawal.id,
      date: withdrawal.withdrawalDate.toISOString(),
      sourceId: withdrawal.id,
      party: withdrawal.personName,
      reference: withdrawal.accountOrMobile,
      detail: withdrawal.reason,
      amount: round2(toAmount(withdrawal.amount) * (withdrawal.isActive ? -1 : 1)),
      isVoided: !withdrawal.isActive,
    });
  }

  // Oldest first, so the running balance can be carried forward from the
  // opening figure. `at` is the full timestamp in milliseconds, not the date, so
  // two movements in the same afternoon stay in the order they were booked.
  // Transfers only. Kept out of the party-name lookup because the counterparty
  // here is always another account, never a person - `party` carries the other
  // account's name so the row can say where the money went or came from, and
  // `detail` carries the owner's remarks.
  for (const transfer of transfersOut) {
    drafts.push({
      key: `transferOut:${transfer.id}`,
      kind: "transferOut",
      at: transfer.createdAt.getTime(),
      order: transfer.id,
      date: transfer.createdAt.toISOString(),
      sourceId: transfer.id,
      party: transfer.toBank.bankName,
      reference: null,
      detail: transfer.remarks,
      // A voided transfer had its movement undone, so what this account saw was
      // the money coming back - the opposite sign.
      amount: round2(toAmount(transfer.amount) * (transfer.isActive ? -1 : 1)),
      isVoided: !transfer.isActive,
    });
  }

  for (const transfer of transfersIn) {
    drafts.push({
      key: `transferIn:${transfer.id}`,
      kind: "transferIn",
      at: transfer.createdAt.getTime(),
      order: transfer.id,
      date: transfer.createdAt.toISOString(),
      sourceId: transfer.id,
      party: transfer.fromBank.bankName,
      reference: null,
      detail: transfer.remarks,
      amount: round2(toAmount(transfer.amount) * (transfer.isActive ? 1 : -1)),
      isVoided: !transfer.isActive,
    });
  }

  drafts.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.order - b.order);

  // The running figure starts from the opening balance, so the last row's
  // balance is the statement's own answer for what the account should hold.
  let running = bank.initialBalance;
  const rows: BankStatementRow[] = drafts.map((draft) => {
    running = round2(running + draft.amount);
    return {
      key: draft.key,
      kind: draft.kind,
      date: draft.date,
      sourceId: draft.sourceId,
      party: draft.party,
      reference: draft.reference,
      detail: draft.detail,
      amount: draft.amount,
      balance: running,
      isVoided: draft.isVoided,
    };
  });

  const totalIn = round2(rows.reduce((sum, row) => sum + Math.max(row.amount, 0), 0));
  const totalOut = round2(rows.reduce((sum, row) => sum + Math.max(-row.amount, 0), 0));
  const ledgerBalance = round2(bank.initialBalance + totalIn - totalOut);

  return {
    bank,
    openingBalance: bank.initialBalance,
    // Newest first, by date AND time - which is what reversing the
    // chronological order gives, since `at` carries the time of day. Each row
    // still holds the balance as of its own timestamp, so displaying them in
    // reverse costs nothing. The screen prints the time alongside the date for
    // the same reason: without it, a day of cash movements looks like one
    // unordered block.
    rows: rows.reverse(),
    totalIn,
    totalOut,
    ledgerBalance,
    // The owner can overwrite remainingBalance on the Banks screen to record a
    // recount. That is legitimate bookkeeping, not drift, so the statement
    // reports the gap instead of pretending one of the two numbers is wrong.
    isAdjusted: round2(bank.remainingBalance) !== ledgerBalance,
    voidedCount: rows.filter((row) => row.isVoided).length,
  };
}

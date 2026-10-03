import type { PrismaClient, Prisma } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { BankError, applyBankDelta, requireActiveBank } from "@/lib/banks";
import { round2 } from "@/lib/returns";

/**
 * What the money was spent on. The vocabulary lives in the database for the same
 * reason BankInfo.bankName does: what counts as an expense is the thing that
 * varies per shop, so the owner types their own heads and the dropdown is built
 * from whatever exists.
 *
 * Seeded into a brand new tenant by provisionCompany() and into the tenants that
 * already exist by the 20261016000000_add_expenditure migration. The duplication
 * is deliberate, exactly as it is for DEFAULT_BANK_NAMES: the migration has to be
 * plain SQL because it runs inside the migration engine.
 */
export const DEFAULT_EXPENDITURE_HEADS = [
  "Salary",
  "Rent",
  "Electricity",
  "Gas",
  "Internet",
  "Transportation",
  "Entertainment",
  "Office Supplies",
  "Repairs and Maintenance",
  "Bank Charge",
  "Others",
] as const;

/**
 * Money leaving the business for something that is not stock and not a withdrawal
 * from the owner's own pocket: a month's salary, a client dinner, the transport
 * to go and look at a site.
 *
 * The shape is a voucher, and that is the whole point of the feature. Real
 * expenditure arrives as a pile - one trip to the market covers the rent run, the
 * fuel and the lunch - and the owner thinks of it as one event with several
 * reasons under it. So one Expenditure is the header (a date, a note, and the
 * three optional extras) and it holds any number of ExpenditureItem lines, each
 * filed under a head and settled through its own account.
 *
 * Two rules run through everything below:
 *
 * 1. Every balance move happens inside the caller's transaction, through
 *    applyBankDelta, exactly as a withdrawal does. A voucher's running figures
 *    and the account balances that explain them can never disagree.
 * 2. Nothing is ever hard-deleted. The money has already moved, so removing a
 *    voucher has to move it back, which is what `isActive = false` is for.
 */
export class ExpenditureError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type ExpenditureHeadRow = {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
};

export type ExpenditureItemRow = {
  id: number;
  headId: number;
  headName: string;
  description: string | null;
  billNo: string | null;
  amount: number;
};

export type ExpenditureRow = {
  id: number;
  expenditureDate: string;
  note: string | null;
  transportationCost: number;
  additionalCost: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  /** One account for the whole voucher, not one per line. */
  paymentMethod: string | null;
  isPaid: boolean;
  isActive: boolean;
  items: ExpenditureItemRow[];
  createdAt: string;
  updatedAt: string;
};

/** Every account a mutation touched, with the balance it ended on. Lets the
 *  screen show "balance after" without a second request, the way the
 *  Withdrawals screen does. */
export type ExpenditureBalances = Record<string, number>;

type ExpenditureRecord = {
  id: number;
  expenditureDate: Date;
  note: string | null;
  transportationCost: number;
  additionalCost: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  paymentMethod: string | null;
  isPaid: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  items: ExpenditureItemRecord[];
};

type ExpenditureItemRecord = {
  id: number;
  headId: number;
  description: string | null;
  billNo: string | null;
  amount: number;
  head: { name: string };
};

const EXPENDITURE_INCLUDE = {
  items: {
    include: { head: { select: { name: true } } },
    orderBy: { id: "asc" },
  },
} as const;

function toRow(record: ExpenditureRecord): ExpenditureRow {
  return {
    id: record.id,
    expenditureDate: record.expenditureDate.toISOString(),
    note: record.note,
    transportationCost: record.transportationCost,
    additionalCost: record.additionalCost,
    discount: record.discount,
    totalAmount: record.totalAmount,
    paidAmount: record.paidAmount,
    // Derived rather than stored: what the owner still owes on this voucher.
    // Never negative even when a discount exceeds the lines, because the
    // discount has already been credited back to an account by that point.
    unpaidAmount: round2(Math.max(0, record.totalAmount - record.paidAmount)),
    paymentMethod: record.paymentMethod,
    isPaid: record.isPaid,
    isActive: record.isActive,
    items: record.items.map((item) => ({
      id: item.id,
      headId: item.headId,
      headName: item.head.name,
      description: item.description,
      billNo: item.billNo,
      amount: item.amount,
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function text(raw: unknown): string {
  return String(raw ?? "").trim();
}

/** Optional free text - an empty box and an absent field mean the same thing. */
function optionalText(raw: unknown): string | null {
  const value = text(raw);
  return value === "" ? null : value;
}

/** A money field that must be a real, finite, non-negative number. Unlike an
 *  amount, an extra may legitimately be zero, and a discount may not be
 *  negative - a negative discount would be a surcharge, which is what
 *  additionalCost is for. */
function parseNonNegative(raw: unknown, field: string): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  const value = round2(Number(raw));
  if (!Number.isFinite(value) || value < 0) {
    throw new ExpenditureError(400, `${field} must be 0 or more`);
  }
  return value;
}

function parseAmount(raw: unknown, field: string): number {
  const amount = round2(Number(raw));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ExpenditureError(400, `${field} must be greater than 0`);
  }
  return amount;
}

function parseDate(raw: unknown): Date {
  const value = new Date(text(raw));
  if (Number.isNaN(value.getTime())) {
    throw new ExpenditureError(400, "Invalid expenditureDate");
  }
  const today = new Date();
  if (value.getTime() > today.getTime()) {
    throw new ExpenditureError(400, "expenditureDate cannot be in the future");
  }
  return value;
}

/* ------------------------------------------------------------------ heads -- */

/** Every head, for the management list. Includes deactivated rows so the owner
 *  can see (and reactivate) a head that history points at. */
export async function listExpenditureHeads(db: PrismaClient): Promise<ExpenditureHeadRow[]> {
  const rows = await db.expenditureHead.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Only the active heads - the list the expenditure line dropdown is built from.
 *  A deactivated head leaves the dropdown but keeps every line filed under it. */
export async function listActiveExpenditureHeads(db: PrismaClient): Promise<ExpenditureHeadRow[]> {
  const rows = await db.expenditureHead.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }));
}

function normalizeHeadName(raw: unknown): string {
  const name = text(raw);
  if (!name) {
    throw new ExpenditureError(400, "name is required");
  }
  if (name.length > 191) {
    throw new ExpenditureError(400, "name is too long");
  }
  return name;
}

export async function createExpenditureHead(
  db: PrismaClient,
  session: TenantSession,
  input: { name?: unknown; isActive?: unknown }
): Promise<ExpenditureHeadRow> {
  const name = normalizeHeadName(input.name);
  try {
    const created = await db.expenditureHead.create({ data: { name } });
    await writeAuditLog(db, session, {
      action: "expenditureHead.created",
      entityType: "ExpenditureHead",
      entityId: created.id,
      after: { name: created.name },
    });
    return {
      id: created.id,
      name: created.name,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ExpenditureError(409, "An expenditure head with this name already exists");
    }
    throw err;
  }
}

/**
 * Renames or (de)activates a head. The name IS editable here, unlike
 * BankInfo.bankName, because nothing stores it as a snapshot string -
 * ExpenditureItem keeps a real foreign key to the head, so a rename re-labels
 * the history instead of orphaning it. Deactivating is the "remove" action and
 * leaves every line intact.
 */
export async function updateExpenditureHead(
  db: PrismaClient,
  session: TenantSession,
  id: number,
  input: { name?: unknown; isActive?: unknown }
): Promise<ExpenditureHeadRow> {
  const head = await db.expenditureHead.findUnique({ where: { id } });
  if (!head) {
    throw new ExpenditureError(404, "Expenditure head not found");
  }

  const data: { name?: string; isActive?: boolean } = {};
  if (input.name !== undefined) data.name = normalizeHeadName(input.name);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (Object.keys(data).length === 0) {
    throw new ExpenditureError(400, "Nothing to update");
  }

  try {
    const updated = await db.expenditureHead.update({ where: { id }, data });
    await writeAuditLog(db, session, {
      action: "expenditureHead.updated",
      entityType: "ExpenditureHead",
      entityId: id,
      before: { name: head.name, isActive: head.isActive },
      after: { name: updated.name, isActive: updated.isActive },
    });
    return {
      id: updated.id,
      name: updated.name,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ExpenditureError(409, "An expenditure head with this name already exists");
    }
    throw err;
  }
}

/**
 * Removes a head for good, but only while nothing has been spent against it.
 * ExpenditureItem holds a real foreign key, so a used head cannot go: deleting it
 * would either be refused by the database or strip every past voucher of the
 * reason it was booked. Deactivating is the reversible answer and already takes
 * it out of the dropdown.
 */
export async function deleteExpenditureHead(
  db: PrismaClient,
  session: TenantSession,
  id: number
): Promise<{ name: string }> {
  const head = await db.expenditureHead.findUnique({ where: { id } });
  if (!head) {
    throw new ExpenditureError(404, "Expenditure head not found");
  }
  const used = await db.expenditureItem.count({ where: { headId: id } });
  if (used > 0) {
    throw new ExpenditureError(
      409,
      "This head has been used on an expenditure - deactivate it instead"
    );
  }
  await db.expenditureHead.delete({ where: { id } });
  await writeAuditLog(db, session, {
    action: "expenditureHead.deleted",
    entityType: "ExpenditureHead",
    entityId: id,
    before: { name: head.name },
  });
  return { name: head.name };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/* -------------------------------------------------------------- vouchers -- */

/** The list, newest voucher first. Voided vouchers stay in the answer - the
 *  owner needs to see that money was spent and then put back - so the screen
 *  decides what to hide, not the query. */
export async function listExpenditures(db: PrismaClient): Promise<ExpenditureRow[]> {
  const rows = await db.expenditure.findMany({
    include: EXPENDITURE_INCLUDE,
    orderBy: [{ expenditureDate: "desc" }, { id: "desc" }],
  });
  return rows.map(toRow);
}

/** One voucher with its lines, for the edit form. */
export async function getExpenditure(db: PrismaClient, id: number): Promise<ExpenditureRow> {
  const row = await db.expenditure.findUnique({ where: { id }, include: EXPENDITURE_INCLUDE });
  if (!row) {
    throw new ExpenditureError(404, "Expenditure not found");
  }
  return toRow(row);
}

type ParsedItem = {
  headId: number;
  description: string | null;
  billNo: string | null;
  amount: number;
};

/**
 * Validates the lines: each one names a head that still exists and an amount
 * above zero. A line carries no payment detail - the whole voucher is settled in
 * one go, so there is nothing per-line left to check.
 */
async function parseItems(db: PrismaClient, raw: unknown): Promise<ParsedItem[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ExpenditureError(400, "An expenditure needs at least one line");
  }
  if (raw.length > 100) {
    throw new ExpenditureError(400, "An expenditure cannot have more than 100 lines");
  }

  const headIds = raw.map((entry, index) => {
    const value = Number((entry as { headId?: unknown })?.headId);
    if (!Number.isInteger(value) || value < 1) {
      throw new ExpenditureError(400, `Line ${index + 1}: headId is required`);
    }
    return value;
  });
  const uniqueHeadIds = [...new Set(headIds)];
  const found = await db.expenditureHead.findMany({
    where: { id: { in: uniqueHeadIds } },
    select: { id: true, isActive: true },
  });
  const byId = new Map(found.map((h) => [h.id, h]));
  for (const headId of uniqueHeadIds) {
    const head = byId.get(headId);
    if (!head) {
      throw new ExpenditureError(400, "Unknown expenditure head");
    }
    if (!head.isActive) {
      // A line booked after the head was switched off would point the report at
      // something the owner has already retired.
      throw new ExpenditureError(400, "This expenditure head has been deactivated");
    }
  }

  const items: ParsedItem[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = (raw[index] ?? {}) as Record<string, unknown>;
    items.push({
      headId: headIds[index] as number,
      description: optionalText(entry.description),
      billNo: optionalText(entry.billNo),
      amount: parseAmount(entry.amount, `Line ${index + 1} amount`),
    });
  }
  return items;
}

type ParsedVoucher = {
  expenditureDate: Date;
  note: string | null;
  transportationCost: number;
  additionalCost: number;
  discount: number;
  /** The one account the whole voucher is settled through, or null while unpaid. */
  paymentMethod: string | null;
  isPaid: boolean;
  items: ParsedItem[];
};

/** The three optional header extras, as one signed figure.
 *
 *  + transportation + additional - discount
 *
 * This is the number that actually crosses an account when the owner marks the
 * extras as settled. It is signed rather than clamped because a discount larger
 * than the two costs is a real and common thing - the supplier rounded the
 * invoice down - and that money comes back to the account, which applyBankDelta
 * handles happily in either direction.
 */
function extrasNet(voucher: {
  transportationCost: number;
  additionalCost: number;
  discount: number;
}): number {
  return round2(voucher.transportationCost + voucher.additionalCost - voucher.discount);
}

async function parseVoucher(db: PrismaClient, body: Record<string, unknown>): Promise<ParsedVoucher> {
  const transportationCost = parseNonNegative(body.transportationCost, "transportationCost");
  const additionalCost = parseNonNegative(body.additionalCost, "additionalCost");
  const discount = parseNonNegative(body.discount, "discount");

  // The voucher settles as one amount, so paid/not and which account are
  // header-level questions asked once, after the heads are known.
  const isPaid = body.isPaid === undefined ? true : Boolean(body.isPaid);
  const rawMethod = optionalText(body.paymentMethod);
  if (isPaid && !rawMethod) {
    throw new ExpenditureError(400, "A paid expenditure needs a payment method");
  }

  // Checked against bank_info BEFORE the posting transaction opens - the same
  // choice createPayment makes, so a mistyped account does not take a lock only
  // to fail. An unpaid voucher names no account, so there is nothing to check.
  const paymentMethod = isPaid && rawMethod ? await requireActiveBank(db, rawMethod) : null;

  const items = await parseItems(db, body.items);

  // A discount is money coming back, so it can exceed one line or one extra but
  // not the whole voucher: a total below zero would mean the business was paid
  // to spend, which is a data-entry slip rather than a real discount, and it
  // would leave a negative total, a negative balance-after on the account and
  // nothing in the ledger to make sense of it.
  const gross = round2(
    items.reduce((sum, item) => sum + item.amount, 0) + transportationCost + additionalCost
  );
  if (discount > gross) {
    throw new ExpenditureError(400, "The discount is more than the whole voucher");
  }

  return {
    expenditureDate: parseDate(body.expenditureDate),
    note: optionalText(body.note),
    transportationCost,
    additionalCost,
    discount,
    paymentMethod,
    isPaid: paymentMethod !== null,
    items,
  };
}

/** The stored figures, derived once so the columns and the money cannot drift:
 *  every path that writes an Expenditure computes them through here. */
function totalsFor(voucher: ParsedVoucher): { totalAmount: number; paidAmount: number } {
  const lineSum = round2(voucher.items.reduce((sum, item) => sum + item.amount, 0));
  const totalAmount = round2(lineSum + extrasNet(voucher));
  // One settlement for the whole voucher: either the entire total has left the
  // account or none of it has.
  const paidAmount = voucher.isPaid ? totalAmount : 0;
  return { totalAmount, paidAmount };
}

/**
 * Applies (or reverses) the voucher on its account, and reports the balance it
 * ended on.
 *
 * `sign` is -1 to move the voucher's money out and +1 to put it back, so a void
 * and a correction are literally this function called the other way. An unpaid
 * voucher touches nothing, which is what makes "recorded but not yet paid" cost
 * nothing.
 *
 * Note the direction convention, which is applyBankDelta's: the delta is ADDED
 * to the balance, so paying out is negative and money coming back is positive -
 * the same way Withdrawal calls it with -amount to spend and +amount to refund.
 */
async function applyVoucher(
  tx: Prisma.TransactionClient,
  voucher: ParsedVoucher,
  sign: 1 | -1
): Promise<ExpenditureBalances> {
  const balances: ExpenditureBalances = {};

  if (!voucher.isPaid || !voucher.paymentMethod) {
    return balances;
  }

  // The single figure that crosses the account is the voucher's own total, the
  // one on screen - not a re-sum of the lines. That keeps the money moved and the
  // number the owner agreed to the same figure by construction.
  const { totalAmount } = totalsFor(voucher);
  if (totalAmount === 0) {
    return balances;
  }
  balances[voucher.paymentMethod] = await applyBankDelta(
    tx,
    voucher.paymentMethod,
    round2(sign * totalAmount)
  );
  return balances;
}

function auditTotals(voucher: ParsedVoucher, balances: ExpenditureBalances) {
  const { totalAmount, paidAmount } = totalsFor(voucher);
  return { totalAmount, paidAmount, bankBalancesAfter: balances };
}

/**
 * Records a voucher and takes the money out of every account it names, in one
 * transaction. A voucher can never exist without the money having moved, and the
 * money can never move without a voucher saying so.
 */
export async function createExpenditure(
  db: PrismaClient,
  session: TenantSession,
  body: Record<string, unknown>
): Promise<{ expenditure: ExpenditureRow; bankBalances: ExpenditureBalances }> {
  const voucher = await parseVoucher(db, body);
  const { totalAmount, paidAmount } = totalsFor(voucher);

  return db.$transaction(async (tx) => {
    const balances = await applyVoucher(tx, voucher, -1);

    const created = await tx.expenditure.create({
      data: {
        expenditureDate: voucher.expenditureDate,
        note: voucher.note,
        transportationCost: voucher.transportationCost,
        additionalCost: voucher.additionalCost,
        discount: voucher.discount,
        totalAmount,
        paidAmount,
        paymentMethod: voucher.paymentMethod,
        isPaid: voucher.isPaid,
        items: {
          create: voucher.items.map((item) => ({
            headId: item.headId,
            description: item.description,
            billNo: item.billNo,
            amount: item.amount,
          })),
        },
      },
      include: EXPENDITURE_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "expenditure.created",
      entityType: "Expenditure",
      entityId: created.id,
      after: {
        expenditureDate: voucher.expenditureDate.toISOString(),
        lineCount: voucher.items.length,
        ...auditTotals(voucher, balances),
      },
    });

    return { expenditure: toRow(created), bankBalances: balances };
  });
}

export type UpdateExpenditureInput = Record<string, unknown>;

/**
 * Edits a voucher. The lines are replaced wholesale rather than diffed, which is
 * what the form actually submits - the owner sees a list of lines and sends the
 * list they want - and it keeps "a line was removed" from being a special case.
 *
 * The balances follow the same undo-then-apply order as a corrected withdrawal:
 * the whole old voucher is reversed first, then the new one is applied. Net
 * effect is always the difference, and a line moved from bKash to cash moves the
 * money with it.
 *
 * A voided voucher is frozen history - its reversal is already in the balances,
 * so editing it would double-count. Record a new one instead.
 */
export async function updateExpenditure(
  db: PrismaClient,
  session: TenantSession,
  id: number,
  body: UpdateExpenditureInput
): Promise<{ expenditure: ExpenditureRow; bankBalances: ExpenditureBalances }> {
  const voucher = await parseVoucher(db, body);
  const { totalAmount, paidAmount } = totalsFor(voucher);

  return db.$transaction(async (tx) => {
    const existing = await tx.expenditure.findUnique({
      where: { id },
      include: EXPENDITURE_INCLUDE,
    });
    if (!existing) {
      throw new ExpenditureError(404, "Expenditure not found");
    }
    if (!existing.isActive) {
      throw new ExpenditureError(400, "A voided expenditure cannot be edited");
    }

    const oldVoucher: ParsedVoucher = {
      expenditureDate: existing.expenditureDate,
      note: existing.note,
      transportationCost: existing.transportationCost,
      additionalCost: existing.additionalCost,
      discount: existing.discount,
      paymentMethod: existing.paymentMethod,
      isPaid: existing.isPaid,
      items: existing.items.map((item) => ({
        headId: item.headId,
        description: item.description,
        billNo: item.billNo,
        amount: item.amount,
      })),
    };

    const balances = await applyVoucher(tx, oldVoucher, 1);
    const newBalances = await applyVoucher(tx, voucher, -1);

    await tx.expenditureItem.deleteMany({ where: { expenditureId: id } });
    const updated = await tx.expenditure.update({
      where: { id },
      data: {
        expenditureDate: voucher.expenditureDate,
        note: voucher.note,
        transportationCost: voucher.transportationCost,
        additionalCost: voucher.additionalCost,
        discount: voucher.discount,
        paymentMethod: voucher.paymentMethod,
        isPaid: voucher.isPaid,
        totalAmount,
        paidAmount,
        items: {
          create: voucher.items.map((item) => ({
            headId: item.headId,
            description: item.description,
            billNo: item.billNo,
            amount: item.amount,
          })),
        },
      },
      include: EXPENDITURE_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "expenditure.updated",
      entityType: "Expenditure",
      entityId: id,
      before: { totalAmount: existing.totalAmount, paidAmount: existing.paidAmount },
      after: {
        lineCount: voucher.items.length,
        ...auditTotals(voucher, { ...balances, ...newBalances }),
      },
    });

    return { expenditure: toRow(updated), bankBalances: { ...balances, ...newBalances } };
  });
}

/**
 * The "delete" action, and the reason this model has no hard delete: the money
 * has already moved, so removing the voucher has to move it back or the accounts
 * would be short by a sum nobody can trace. `isActive = false` keeps the voucher
 * visible on the screen as voided.
 */
export async function voidExpenditure(
  db: PrismaClient,
  session: TenantSession,
  id: number
): Promise<{ expenditure: ExpenditureRow; bankBalances: ExpenditureBalances }> {
  return db.$transaction(async (tx) => {
    const existing = await tx.expenditure.findUnique({
      where: { id },
      include: EXPENDITURE_INCLUDE,
    });
    if (!existing) {
      throw new ExpenditureError(404, "Expenditure not found");
    }
    if (!existing.isActive) {
      throw new ExpenditureError(400, "Expenditure is already voided");
    }

    const voucher: ParsedVoucher = {
      expenditureDate: existing.expenditureDate,
      note: existing.note,
      transportationCost: existing.transportationCost,
      additionalCost: existing.additionalCost,
      discount: existing.discount,
      paymentMethod: existing.paymentMethod,
      isPaid: existing.isPaid,
      items: existing.items.map((item) => ({
        headId: item.headId,
        description: item.description,
        billNo: item.billNo,
        amount: item.amount,
      })),
    };

    // The whole point of the action: the money goes back where it came from.
    const balances = await applyVoucher(tx, voucher, 1);

    const updated = await tx.expenditure.update({
      where: { id },
      data: { isActive: false },
      include: EXPENDITURE_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "expenditure.voided",
      entityType: "Expenditure",
      entityId: id,
      before: { totalAmount: existing.totalAmount, paidAmount: existing.paidAmount },
      after: { isActive: false, bankBalancesAfter: balances },
    });

    return { expenditure: toRow(updated), bankBalances: balances };
  });
}

/** Re-exported so the API routes can turn a BankError into a response without
 *  importing from two modules to do it. */
export { BankError };
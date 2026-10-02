import type { PrismaClient, Prisma } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/returns";

type TenantDbOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * The "nothing was paid" marker that SalePayment.method / Purchase.paymentMethod
 * accept on top of a real BankInfo.bankName.
 *
 * It is a string in the same column as a bank name rather than a separate flag,
 * so a sale or a purchase records in one column whether it was settled or
 * credited - the reader does not have to know which of two columns to look at.
 * It is NOT a BankInfo row and deliberately has no balance: no money moved, so
 * there is nothing to add or subtract. Settling it later is a separate movement
 * booked on the ledger.
 */
export const DUE_METHOD = "due";

/**
 * The accounts every tenant starts with - the vocabulary the two
 * PaymentMethod/PaymentType enums used to hard-code.
 *
 * One definition, applied twice: `provisionCompany()` seeds it into a freshly
 * created tenant database, and the migration seeds it into the tenants that
 * already exist. `due` is absent on purpose - see DUE_METHOD.
 */
export const DEFAULT_BANK_NAMES = [
  "cash",
  "card",
  "bank",
  "bkash",
  "rocket",
  "nagad",
  "upay",
  "banglaqr",
  "other",
] as const;

export type BankRow = {
  id: number;
  bankName: string;
  initialBalance: number;
  remainingBalance: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export class BankError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A name is stored exactly as typed, trimmed, so it matches the value on every row that references it. */
function normalizeName(raw: unknown): string {
  return String(raw ?? "").trim();
}

function toBankRow(row: {
  id: number;
  bankName: string;
  initialBalance: number;
  remainingBalance: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): BankRow {
  return {
    id: row.id,
    bankName: row.bankName,
    initialBalance: row.initialBalance,
    remainingBalance: row.remainingBalance,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Every account, for the Banks screen. Includes deactivated rows so the owner
 * can still see (and reactivate) an account that history points at.
 */
export async function listBanks(db: PrismaClient): Promise<BankRow[]> {
  const rows = await db.bankInfo.findMany({ orderBy: { id: "asc" } });
  return rows.map(toBankRow);
}

/**
 * Only the active accounts - the list the POS tender, the purchase method and
 * the ledger's "paid by" dropdown are built from. `due` is not included: it is
 * a settlement marker, not somewhere money sits. Those two screens add `due`
 * themselves, so the list stays empty-and-useless only if the owner has
 * deactivated every account.
 *
 * Carries the running balance so the cashier can see how much is in the drawer
 * while choosing where to book the sale, without a second request.
 */
export async function listActiveBanks(db: PrismaClient): Promise<BankRow[]> {
  const rows = await db.bankInfo.findMany({ where: { isActive: true }, orderBy: { id: "asc" } });
  return rows.map(toBankRow);
}

/**
 * Validates that `name` is an active account. Throws BankError(400) with a
 * client-safe message otherwise.
 *
 * Takes a client or a transaction: `createPayment` passes the request-level
 * client so a typo is rejected before the posting transaction opens and takes
 * any locks; `updatePayment` passes its transaction, since it has to undo the
 * old posting and has no useful work to do if the new method is unusable.
 */
export async function requireActiveBank(db: TenantDbOrTx, name: unknown): Promise<string> {
  const bankName = normalizeName(name);
  if (!bankName) {
    throw new BankError(400, "Unknown payment method");
  }
  const bank = await db.bankInfo.findUnique({ where: { bankName } });
  if (!bank || !bank.isActive) {
    throw new BankError(400, "Unknown payment method");
  }
  return bankName;
}

/**
 * The same check, but accepts DUE_METHOD as well - the two flows that can be
 * settled on credit (a POS sale, a purchase) use this instead.
 */
export async function requireSettlementMethod(db: PrismaClient, method: unknown): Promise<string> {
  const value = normalizeName(method);
  if (value === DUE_METHOD) return value;
  return requireActiveBank(db, value);
}

/**
 * Moves an account's running balance by `delta`, inside the caller's transaction
 * so the balance can never disagree with the row that explains it. Returns the
 * new balance.
 *
 * Only checks that the account exists - never that it is active. A reversal (a
 * voided payment, an edited payment undoing its old posting) has to be able to
 * move money through an account that was deactivated after the fact, otherwise
 * correcting history would fail on the one row that most needs correcting.
 * New postings are gated by requireActiveBank instead.
 *
 * The balance is not floored at zero: an overdrawn account is a real state, and
 * silently parking it at 0 would hide the overdraft on every balance sheet.
 */
export async function applyBankDelta(
  db: TenantDbOrTx,
  bankName: string,
  delta: number
): Promise<number> {
  const bank = await db.bankInfo.findUnique({ where: { bankName } });
  if (!bank) {
    throw new BankError(400, "Unknown payment method");
  }

  // Nothing to move, but the caller still wants the resulting figure - and an
  // unknown name must still be an error even for a zero-amount movement.
  const remainingBalance = round2(bank.remainingBalance + delta);
  if (delta === 0) return remainingBalance;

  await db.bankInfo.update({
    where: { id: bank.id },
    data: { remainingBalance },
  });
  return remainingBalance;
}

export type CreateBankInput = {
  bankName?: unknown;
  initialBalance?: unknown;
  remainingBalance?: unknown;
};

export type UpdateBankInput = CreateBankInput & { isActive?: unknown };

/**
 * Parses a balance field. Both are declared by the owner rather than earned, so
 * a negative opening figure is legitimate (an overdrawn account); only a
 * non-number is rejected.
 */
function parseBalance(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return round2(value);
}

export async function createBank(
  db: PrismaClient,
  session: TenantSession,
  input: CreateBankInput
): Promise<BankRow> {
  const bankName = normalizeName(input.bankName);
  if (!bankName) {
    throw new BankError(400, "bankName is required");
  }
  if (bankName === DUE_METHOD) {
    throw new BankError(400, `'${DUE_METHOD}' is reserved - it means no money was paid`);
  }

  // The defaults (0/0) are only used when the caller omits a balance entirely,
  // which is the whole point of the screen: an account can be created with just
  // a name and have its figures filled in whenever the owner gets round to it.
  const initialBalance = parseBalance(input.initialBalance) ?? 0;
  const remainingBalance = parseBalance(input.remainingBalance) ?? 0;

  try {
    const created = await db.bankInfo.create({ data: { bankName, initialBalance, remainingBalance } });
    await writeAuditLog(db, session, {
      action: "bank.created",
      entityType: "BankInfo",
      entityId: created.id,
      after: { bankName: created.bankName, initialBalance, remainingBalance },
    });
    return toBankRow(created);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new BankError(409, "A bank or payment method with this name already exists");
    }
    throw err;
  }
}

/**
 * Edits an account in place. The name is deliberately NOT editable: it is the
 * value stored verbatim on every SalePayment / Purchase / Payment row that
 * names this account, so renaming would orphan that history into a label no
 * longer in the table. Deactivate and add a new one instead.
 */
export async function updateBank(
  db: PrismaClient,
  session: TenantSession,
  id: number,
  input: UpdateBankInput
): Promise<BankRow> {
  const bank = await db.bankInfo.findUnique({ where: { id } });
  if (!bank) {
    throw new BankError(404, "Bank not found");
  }

  const data: { initialBalance?: number; remainingBalance?: number; isActive?: boolean } = {};
  const initialBalance = parseBalance(input.initialBalance);
  if (initialBalance !== undefined) data.initialBalance = initialBalance;
  const remainingBalance = parseBalance(input.remainingBalance);
  if (remainingBalance !== undefined) data.remainingBalance = remainingBalance;
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  if (Object.keys(data).length === 0) {
    throw new BankError(400, "Nothing to update");
  }

  const updated = await db.bankInfo.update({ where: { id }, data });

  await writeAuditLog(db, session, {
    action: "bank.updated",
    entityType: "BankInfo",
    entityId: id,
    before: {
      bankName: bank.bankName,
      initialBalance: bank.initialBalance,
      remainingBalance: bank.remainingBalance,
      isActive: bank.isActive,
    },
    after: {
      bankName: updated.bankName,
      initialBalance: updated.initialBalance,
      remainingBalance: updated.remainingBalance,
      isActive: updated.isActive,
    },
  });

  return toBankRow(updated);
}

/**
 * Removes an account for good.
 *
 * Refuses once any sale, purchase or payment names it. Those three columns store
 * the name as text rather than a foreign key (see the schema comment on
 * BankInfo), so the row could be deleted and the history would keep rendering a
 * method that no longer exists anywhere - and its balance would silently vanish
 * from every total while the transactions that moved it are still on the books.
 * Deactivating is the reversible answer for an account that has been used, and
 * it already takes it out of every dropdown, which is the same visible result.
 */
export async function deleteBank(
  db: PrismaClient,
  session: TenantSession,
  id: number
): Promise<{ bankName: string }> {
  const bank = await db.bankInfo.findUnique({ where: { id } });
  if (!bank) {
    throw new BankError(404, "Bank not found");
  }

  const [sales, purchases, payments] = await Promise.all([
    db.salePayment.count({ where: { method: bank.bankName } }),
    db.purchase.count({ where: { paymentMethod: bank.bankName } }),
    db.payment.count({ where: { paymentType: bank.bankName } }),
  ]);
  if (sales + purchases + payments > 0) {
    throw new BankError(
      409,
      "This account has past sales, purchases or payments - deactivate it instead"
    );
  }

  await db.bankInfo.delete({ where: { id } });
  await writeAuditLog(db, session, {
    action: "bank.deleted",
    entityType: "BankInfo",
    entityId: id,
    before: { bankName: bank.bankName, initialBalance: bank.initialBalance },
  });

  return { bankName: bank.bankName };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

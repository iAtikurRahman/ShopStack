import type { PrismaClient, Prisma } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { applyBankDelta } from "@/lib/banks";
import { round2 } from "@/lib/returns";

type TenantDbOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * The owner taking money out of an account and into their own pocket.
 *
 * This is the one movement in the app whose sign runs opposite to a sale: a
 * cash sale ADDS to the account it was taken through, a withdrawal REMOVES from
 * the account it came out of. Cash 1000, owner withdraws 300, cash is 700.
 *
 * The balance is moved inside the caller's transaction, so an account's running
 * figure can never disagree with the slip that explains it.
 */
export class WithdrawalError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type WithdrawalRow = {
  id: number;
  bankId: number;
  bankName: string;
  withdrawalDate: string;
  personName: string;
  accountOrMobile: string | null;
  amount: number;
  reason: string | null;
  isActive: boolean;
  createdAt: string;
};

type WithdrawalRecord = {
  id: number;
  bankId: number;
  withdrawalDate: Date;
  personName: string;
  accountOrMobile: string | null;
  amount: number;
  reason: string | null;
  isActive: boolean;
  createdAt: Date;
  bank: { bankName: string };
};

const WITHDRAWAL_INCLUDE = { bank: { select: { bankName: true } } } as const;

function toRow(record: WithdrawalRecord): WithdrawalRow {
  return {
    id: record.id,
    bankId: record.bankId,
    bankName: record.bank.bankName,
    withdrawalDate: record.withdrawalDate.toISOString(),
    personName: record.personName,
    accountOrMobile: record.accountOrMobile,
    amount: record.amount,
    reason: record.reason,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
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

/**
 * The list, newest slip first. Voided slips stay in the answer - the owner needs
 * to see that money was handed over and then put back - so the screen decides
 * what to hide, not the query.
 */
export async function listWithdrawals(db: PrismaClient): Promise<WithdrawalRow[]> {
  const rows = await db.withdrawal.findMany({
    include: WITHDRAWAL_INCLUDE,
    orderBy: [{ withdrawalDate: "desc" }, { id: "desc" }],
  });
  return rows.map(toRow);
}

/**
 * Resolves the account to take the money out of.
 *
 * Existence only, not isActive: an account can be switched off from the dropdown
 * the moment after a withdrawal was booked against it, and that slip still has
 * to be correctable. New slips come from the Banks screen's active list, and
 * `applyBankDelta` is what actually refuses an unknown account.
 */
async function requireBank(db: TenantDbOrTx, bankId: unknown): Promise<{ id: number; bankName: string }> {
  const id = Number(bankId);
  if (!Number.isInteger(id) || id < 1) {
    throw new WithdrawalError(400, "Invalid bank id");
  }
  const bank = await db.bankInfo.findUnique({ where: { id }, select: { id: true, bankName: true } });
  if (!bank) {
    throw new WithdrawalError(404, "Bank not found");
  }
  return bank;
}

function parseAmount(raw: unknown): number {
  const amount = round2(Number(raw));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new WithdrawalError(400, "amount must be greater than 0");
  }
  return amount;
}

function parseDate(raw: unknown): Date {
  const value = new Date(text(raw));
  if (Number.isNaN(value.getTime())) {
    throw new WithdrawalError(400, "Invalid withdrawalDate");
  }
  const today = new Date();
  if (value.getTime() > today.getTime()) {
    throw new WithdrawalError(400, "withdrawalDate cannot be in the future");
  }
  return value;
}

function parsePersonName(raw: unknown): string {
  const name = text(raw);
  if (!name) {
    throw new WithdrawalError(400, "personName is required");
  }
  return name;
}

export type CreateWithdrawalInput = {
  bankId?: unknown;
  withdrawalDate?: unknown;
  personName?: unknown;
  accountOrMobile?: unknown;
  amount?: unknown;
  reason?: unknown;
};

/**
 * Records a withdrawal and takes the amount out of the account in one
 * transaction, so a slip can never exist without the money having left, and
 * money can never leave without a slip saying so.
 */
export async function createWithdrawal(
  db: PrismaClient,
  session: TenantSession,
  input: CreateWithdrawalInput
): Promise<{ withdrawal: WithdrawalRow; bankBalance: number }> {
  const bank = await requireBank(db, input.bankId);
  const withdrawalDate = parseDate(input.withdrawalDate);
  const personName = parsePersonName(input.personName);
  const amount = parseAmount(input.amount);
  const accountOrMobile = optionalText(input.accountOrMobile);
  const reason = optionalText(input.reason);

  return db.$transaction(async (tx) => {
    const bankBalance = await applyBankDelta(tx, bank.bankName, -amount);

    const created = await tx.withdrawal.create({
      data: {
        bankId: bank.id,
        withdrawalDate,
        personName,
        accountOrMobile,
        amount,
        reason,
      },
      include: WITHDRAWAL_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "withdrawal.created",
      entityType: "Withdrawal",
      entityId: created.id,
      after: {
        bankName: bank.bankName,
        personName,
        amount,
        withdrawalDate: withdrawalDate.toISOString(),
        bankBalanceAfter: bankBalance,
      },
    });

    return { withdrawal: toRow(created), bankBalance };
  });
}

export type UpdateWithdrawalInput = CreateWithdrawalInput;

/**
 * Edits a slip. The account balance follows the same undo-then-apply order as a
 * corrected payment: the old amount goes back to the account it came out of,
 * then the new amount comes out of the new one. Correcting a slip that named
 * the wrong account therefore moves the money from where it was actually taken
 * to where it should have been.
 *
 * A voided slip is frozen history - its reversal is already in the balances, so
 * editing it would double-count. Record a new one instead.
 */
export async function updateWithdrawal(
  db: PrismaClient,
  session: TenantSession,
  id: number,
  input: UpdateWithdrawalInput
): Promise<{ withdrawal: WithdrawalRow; bankBalance: number }> {
  return db.$transaction(async (tx) => {
    const existing = await tx.withdrawal.findUnique({ where: { id } });
    if (!existing) {
      throw new WithdrawalError(404, "Withdrawal not found");
    }
    if (!existing.isActive) {
      throw new WithdrawalError(400, "A voided withdrawal cannot be edited");
    }

    const bank = await requireBank(tx, input.bankId ?? existing.bankId);
    const withdrawalDate = input.withdrawalDate === undefined ? existing.withdrawalDate : parseDate(input.withdrawalDate);
    const personName = input.personName === undefined ? existing.personName : parsePersonName(input.personName);
    const amount = input.amount === undefined ? existing.amount : parseAmount(input.amount);
    const accountOrMobile =
      input.accountOrMobile === undefined ? existing.accountOrMobile : optionalText(input.accountOrMobile);
    const reason = input.reason === undefined ? existing.reason : optionalText(input.reason);

    const oldBank = await tx.bankInfo.findUniqueOrThrow({
      where: { id: existing.bankId },
      select: { bankName: true },
    });

    // Put the old amount back first, then take the new one out. Both steps run
    // even when nothing changed, so the net effect is always the difference.
    await applyBankDelta(tx, oldBank.bankName, existing.amount);
    const bankBalance = await applyBankDelta(tx, bank.bankName, -amount);

    const updated = await tx.withdrawal.update({
      where: { id },
      data: { bankId: bank.id, withdrawalDate, personName, accountOrMobile, amount, reason },
      include: WITHDRAWAL_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "withdrawal.updated",
      entityType: "Withdrawal",
      entityId: id,
      before: { bankName: oldBank.bankName, personName: existing.personName, amount: existing.amount },
      after: { bankName: bank.bankName, personName, amount, bankBalanceAfter: bankBalance },
    });

    return { withdrawal: toRow(updated), bankBalance };
  });
}

/**
 * The "delete" action, and the reason this model has no hard delete: the amount
 * has already moved, so removing the row has to move it back or the account
 * would be short by a sum nobody can trace. isActive = false keeps the slip
 * visible on the screen as voided.
 */
export async function voidWithdrawal(
  db: PrismaClient,
  session: TenantSession,
  id: number
): Promise<{ withdrawal: WithdrawalRow; bankBalance: number }> {
  return db.$transaction(async (tx) => {
    const existing = await tx.withdrawal.findUnique({ where: { id } });
    if (!existing) {
      throw new WithdrawalError(404, "Withdrawal not found");
    }
    if (!existing.isActive) {
      throw new WithdrawalError(400, "Withdrawal is already voided");
    }

    const bank = await tx.bankInfo.findUniqueOrThrow({
      where: { id: existing.bankId },
      select: { bankName: true },
    });

    // The whole point of the action: the amount goes back to the account it
    // came out of.
    const bankBalance = await applyBankDelta(tx, bank.bankName, existing.amount);

    const updated = await tx.withdrawal.update({
      where: { id },
      data: { isActive: false },
      include: WITHDRAWAL_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "withdrawal.voided",
      entityType: "Withdrawal",
      entityId: id,
      before: { bankName: bank.bankName, personName: existing.personName, amount: existing.amount },
      after: { isActive: false, bankBalanceAfter: bankBalance },
    });

    return { withdrawal: toRow(updated), bankBalance };
  });
}

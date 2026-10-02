import type { PrismaClient, Prisma } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { applyBankDelta } from "@/lib/banks";
import { round2 } from "@/lib/returns";

type TenantDbOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * The owner moving money out of one of their accounts and into another - cash
 * into the till to top it up, a balance shifted from bKash into a bank account
 * to pay a supplier from.
 *
 * Two things make this the odd one out among the movements in the app:
 *
 *  1. It pushes TWO balances, in opposite directions, in a single transaction.
 *     Every other movement touches one account. That is the whole point of the
 *     feature and also the whole reason the transaction matters - without it a
 *     failure halfway through would leave the money in neither account.
 *
 *  2. It never leaves the business. A sale takes money in from a customer, a
 *     purchase sends it out to a supplier, a withdrawal sends it to the owner's
 *     pocket; a transfer just relabels where it already sits. So the pair of
 *     deltas always sums to zero, and the company-wide total across every
 *     account is unchanged by one. That is worth knowing when reading the
 *     statement: a transfer shows up on both accounts and moves neither total.
 */
export class BankTransferError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type BankTransferRow = {
  id: number;
  fromBankId: number;
  fromBankName: string;
  toBankId: number;
  toBankName: string;
  amount: number;
  remarks: string | null;
  isActive: boolean;
  createdAt: string;
};

type BankTransferRecord = {
  id: number;
  fromBankId: number;
  toBankId: number;
  amount: number;
  remarks: string | null;
  isActive: boolean;
  createdAt: Date;
  fromBank: { bankName: string };
  toBank: { bankName: string };
};

const TRANSFER_INCLUDE = {
  fromBank: { select: { bankName: true } },
  toBank: { select: { bankName: true } },
} as const;

function toRow(record: BankTransferRecord): BankTransferRow {
  return {
    id: record.id,
    fromBankId: record.fromBankId,
    fromBankName: record.fromBank.bankName,
    toBankId: record.toBankId,
    toBankName: record.toBank.bankName,
    amount: record.amount,
    remarks: record.remarks,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
  };
}

function optionalText(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value === "" ? null : value;
}

/**
 * The list, newest first. Voided transfers stay in the answer - the owner needs
 * to see that money was moved and then put back - so the screen decides what to
 * hide, not the query.
 */
export async function listBankTransfers(db: PrismaClient): Promise<BankTransferRow[]> {
  const rows = await db.bankTransfer.findMany({
    include: TRANSFER_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toRow);
}

/**
 * Resolves one side of the transfer.
 *
 * Existence only, not isActive: an account can be switched off from the
 * dropdown the moment after a transfer was booked against it, and that transfer
 * still has to be correctable. New transfers come from the Banks screen's
 * active list, and `applyBankDelta` is what actually refuses an unknown account.
 */
async function requireBank(db: TenantDbOrTx, bankId: unknown): Promise<{ id: number; bankName: string }> {
  const id = Number(bankId);
  if (!Number.isInteger(id) || id < 1) {
    throw new BankTransferError(400, "Invalid bank id");
  }
  const bank = await db.bankInfo.findUnique({ where: { id }, select: { id: true, bankName: true } });
  if (!bank) {
    throw new BankTransferError(404, "Bank not found");
  }
  return bank;
}

function parseAmount(raw: unknown): number {
  const amount = round2(Number(raw));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BankTransferError(400, "amount must be greater than 0");
  }
  return amount;
}

export type CreateBankTransferInput = {
  fromBankId?: unknown;
  toBankId?: unknown;
  amount?: unknown;
  remarks?: unknown;
};

export type UpdateBankTransferInput = CreateBankTransferInput;

export type BankTransferResult = {
  transfer: BankTransferRow;
  /** The two balances as they stand after the movement, so the screen does not have to guess. */
  fromBalance: number;
  toBalance: number;
};

/**
 * Records a transfer and moves the amount between the two accounts in one
 * transaction, so a transfer can never exist without the money having moved and
 * the money can never move without a transfer saying so.
 */
export async function createBankTransfer(
  db: PrismaClient,
  session: TenantSession,
  input: CreateBankTransferInput
): Promise<BankTransferResult> {
  const from = await requireBank(db, input.fromBankId);
  const to = await requireBank(db, input.toBankId);
  if (from.id === to.id) {
    throw new BankTransferError(400, "Pick two different accounts");
  }
  const amount = parseAmount(input.amount);
  const remarks = optionalText(input.remarks);

  return db.$transaction(async (tx) => {
    // From first, then to, so the money is always taken out before it is counted
    // in. An account is allowed to go negative - that is a real state for an
    // account that has just been emptied into another one - and the two updates
    // share this transaction so a failure on either side leaves both balances
    // exactly as they were rather than half-moved.
    const fromBalance = await applyBankDelta(tx, from.bankName, -amount);
    const toBalance = await applyBankDelta(tx, to.bankName, amount);

    const created = await tx.bankTransfer.create({
      data: { fromBankId: from.id, toBankId: to.id, amount, remarks },
      include: TRANSFER_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "bankTransfer.created",
      entityType: "BankTransfer",
      entityId: created.id,
      after: {
        fromBankName: from.bankName,
        toBankName: to.bankName,
        amount,
        remarks,
        fromBalanceAfter: fromBalance,
        toBalanceAfter: toBalance,
      },
    });

    return { transfer: toRow(created), fromBalance, toBalance };
  });
}

/**
 * Edits a transfer. The balances follow the same undo-then-apply order as a
 * corrected payment or withdrawal: the old movement is reversed exactly - the
 * amount goes back to the account it left and comes out of the account it
 * arrived at - and then the new one is applied.
 *
 * Reversing both halves rather than only the amount is what makes a transfer
 * that named the wrong pair of accounts correctable: fixing it moves the money
 * from where it actually went to where it should have gone.
 *
 * A voided transfer is frozen history - its reversal is already in the
 * balances, so editing it would double-count. Record a new one instead.
 */
export async function updateBankTransfer(
  db: PrismaClient,
  session: TenantSession,
  id: number,
  input: UpdateBankTransferInput
): Promise<BankTransferResult> {
  return db.$transaction(async (tx) => {
    const existing = await tx.bankTransfer.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE,
    });
    if (!existing) {
      throw new BankTransferError(404, "Transfer not found");
    }
    if (!existing.isActive) {
      throw new BankTransferError(400, "A voided transfer cannot be edited");
    }

    const from = await requireBank(tx, input.fromBankId ?? existing.fromBankId);
    const to = await requireBank(tx, input.toBankId ?? existing.toBankId);
    if (from.id === to.id) {
      throw new BankTransferError(400, "Pick two different accounts");
    }
    const amount = input.amount === undefined ? existing.amount : parseAmount(input.amount);
    const remarks = input.remarks === undefined ? existing.remarks : optionalText(input.remarks);

    // Reverse the old movement first, in full: put the amount back where it
    // came from, take it back out of where it went. Both steps run even when
    // nothing changed, so the net effect is always the difference.
    await applyBankDelta(tx, existing.fromBank.bankName, existing.amount);
    await applyBankDelta(tx, existing.toBank.bankName, -existing.amount);

    // Then apply the new one.
    const fromBalance = await applyBankDelta(tx, from.bankName, -amount);
    const toBalance = await applyBankDelta(tx, to.bankName, amount);

    const updated = await tx.bankTransfer.update({
      where: { id },
      data: { fromBankId: from.id, toBankId: to.id, amount, remarks },
      include: TRANSFER_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "bankTransfer.updated",
      entityType: "BankTransfer",
      entityId: id,
      before: {
        fromBankName: existing.fromBank.bankName,
        toBankName: existing.toBank.bankName,
        amount: existing.amount,
        remarks: existing.remarks,
      },
      after: {
        fromBankName: from.bankName,
        toBankName: to.bankName,
        amount,
        remarks,
        fromBalanceAfter: fromBalance,
        toBalanceAfter: toBalance,
      },
    });

    return { transfer: toRow(updated), fromBalance, toBalance };
  });
}

/**
 * The "delete" action, and the reason this model has no hard delete: the amount
 * has already moved between two accounts, so removing the row has to move it
 * back or both accounts would be out by a sum nobody can trace. isActive = false
 * keeps the transfer visible on the screen as voided, and on both statements as
 * the correction it was.
 */
export async function deleteBankTransfer(
  db: PrismaClient,
  session: TenantSession,
  id: number
): Promise<BankTransferResult> {
  return db.$transaction(async (tx) => {
    const existing = await tx.bankTransfer.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE,
    });
    if (!existing) {
      throw new BankTransferError(404, "Transfer not found");
    }
    if (!existing.isActive) {
      throw new BankTransferError(400, "Transfer is already voided");
    }

    // The whole point of the action: the amount goes back to the account it left
    // and comes out of the account it reached.
    const fromBalance = await applyBankDelta(tx, existing.fromBank.bankName, existing.amount);
    const toBalance = await applyBankDelta(tx, existing.toBank.bankName, -existing.amount);

    const updated = await tx.bankTransfer.update({
      where: { id },
      data: { isActive: false },
      include: TRANSFER_INCLUDE,
    });

    await writeAuditLog(tx, session, {
      action: "bankTransfer.deleted",
      entityType: "BankTransfer",
      entityId: id,
      before: {
        fromBankName: existing.fromBank.bankName,
        toBankName: existing.toBank.bankName,
        amount: existing.amount,
      },
      after: { isActive: false, fromBalanceAfter: fromBalance, toBalanceAfter: toBalance },
    });

    return { transfer: toRow(updated), fromBalance, toBalance };
  });
}

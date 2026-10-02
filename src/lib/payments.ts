import type { PartyType, Prisma, PrismaClient, TransactionType } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/returns";
import { applyBankDelta, requireActiveBank } from "@/lib/banks";

/**
 * The Payment table is a single ledger covering both sides of the business:
 * money in ("receive") and money out ("payment"), against either a customer or
 * a supplier. Because `customerSupplierId` is a loose int rather than a
 * foreign key (see the schema comment on `Payment`), the pair
 * (transactionType, type) is what decides the direction the party's running
 * dueAmount should move.
 *
 * The four combinations are not arbitrary - each one is the ordinary meaning of
 * that movement, so one sign table covers all of them:
 *
 *   receive + customer  -> they paid us      -> their due goes DOWN
 *   receive + supplier  -> they refunded us  -> what we owe them goes UP
 *   payment + customer  -> we refunded them  -> what they owe goes UP
 *   payment + supplier  -> we paid them      -> what we owe goes DOWN
 *
 * The two "settle a due" cases are the common ones and are what the Users >
 * Payment screen drives; the other two fall out of the same table for free,
 * which is why a single form can serve all four without a mode switch.
 */
const DUE_DIRECTION: Record<TransactionType, Record<PartyType, -1 | 1>> = {
  receive: { customer: -1, supplier: 1 },
  payment: { customer: 1, supplier: -1 },
};

const TRANSACTION_TYPES = new Set<string>(["receive", "payment"]);
const PARTY_TYPES = new Set<string>(["customer", "supplier"]);

/**
 * Which way a movement pushes the account it went through (BankInfo).
 * receive = money landed in the account, payment = money left it.
 *
 * Deliberately a single axis, unlike DUE_DIRECTION above: a party's due and an
 * account's balance are not the same question. "Receive from a supplier" adds
 * to what we owe them AND credits the account - one sign table per balance, two
 * independent meanings for one movement.
 */
const BANK_DIRECTION: Record<TransactionType, 1 | -1> = {
  receive: 1,
  payment: -1,
};

export type PaymentParty = { id: number; name: string; dueAmount: number };

export type PaymentRow = {
  id: number;
  transactionId: string;
  transactionType: TransactionType;
  /**
   * The BankInfo.bankName the money moved through. A loose string rather than a
   * foreign key (see the schema comment on BankInfo) so it stays readable after
   * the account is deactivated.
   */
  paymentType: string;
  type: PartyType;
  customerSupplierId: number;
  paymentDate: string;
  paymentAmount: number;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  partyName: string;
  partyDueAmount: number;
};

export class PaymentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type PartyRow = { id: number; name: string; dueAmount: number };

/** Reads the party named by `type`/`customerSupplierId`, or throws 404. */
async function findParty(
  db: PrismaClient | Prisma.TransactionClient,
  type: PartyType,
  id: number
): Promise<PartyRow> {
  const party =
    type === "customer"
      ? await db.customer.findUnique({ where: { id }, select: { id: true, name: true, dueAmount: true } })
      : await db.supplier.findUnique({ where: { id }, select: { id: true, name: true, dueAmount: true } });
  if (!party) {
    throw new PaymentError(404, type === "customer" ? "Customer not found" : "Supplier not found");
  }
  return party;
}

/**
 * Applies `delta` to the party's dueAmount, never letting a decrease take the
 * balance below zero. Overpaying (settling 100 of a 50 due, or paying a
 * deposit before anything is owed) is allowed and simply parks the balance at
 * 0 - the extra money is real, it just is not a negative receivable.
 */
function nextDueAmount(currentDue: number, delta: number): number {
  return round2(Math.max(0, currentDue + delta));
}

/** Writes a balance back to whichever of the two party tables `type` names. */
async function applyDueAmount(
  db: PrismaClient | Prisma.TransactionClient,
  type: PartyType,
  id: number,
  dueAmount: number
): Promise<void> {
  if (type === "customer") {
    await db.customer.update({ where: { id }, data: { dueAmount } });
  } else {
    await db.supplier.update({ where: { id }, data: { dueAmount } });
  }
}

/**
 * Builds a human-facing trace number. The column is UNIQUE precisely so a
 * double-submitted form cannot book the same movement twice, so a caller may
 * pass their own bank/receipt reference - when they do not, we mint one.
 */
function generateTransactionId(): string {
  const stamp = new Date();
  const ymd = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `PV-${ymd}-${suffix}`;
}

export type CreatePaymentInput = {
  transactionId?: unknown;
  transactionType?: unknown;
  paymentType?: unknown;
  type?: unknown;
  customerSupplierId?: unknown;
  paymentDate?: unknown;
  paymentAmount?: unknown;
  description?: unknown;
};

export type UpdatePaymentInput = CreatePaymentInput;

type ValidPayment = {
  transactionId: string;
  transactionType: TransactionType;
  paymentType: string;
  type: PartyType;
  customerSupplierId: number;
  paymentDate: Date;
  paymentAmount: number;
  description: string | null;
};

/** Validates the request body. Throws PaymentError(400) with a client-safe message. */
function validate(input: CreatePaymentInput): ValidPayment {
  const transactionType = String(input.transactionType ?? "");
  if (!TRANSACTION_TYPES.has(transactionType)) {
    throw new PaymentError(400, "transactionType must be receive or payment");
  }

  // The payment method is a BankInfo.bankName, so it cannot be checked against a
  // fixed list here - requireActiveBank resolves it against the database just
  // before the transaction opens, and rejects a deactivated account too.
  const paymentType = String(input.paymentType ?? "").trim();
  if (!paymentType) {
    throw new PaymentError(400, "Unknown payment method");
  }

  const type = String(input.type ?? "");
  if (!PARTY_TYPES.has(type)) {
    throw new PaymentError(400, "type must be customer or supplier");
  }

  const partyId = Number(input.customerSupplierId);
  if (!Number.isInteger(partyId) || partyId < 1) {
    throw new PaymentError(400, "customerSupplierId must be a positive whole number");
  }

  const amount = Number(input.paymentAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentError(400, "paymentAmount must be greater than 0");
  }

  // Backdating is allowed (a payment logged "paid last Tuesday"), but a date in
  // the future would quietly corrupt every arrears report drawn from it.
  let paymentDate = new Date();
  if (input.paymentDate !== undefined && input.paymentDate !== null && input.paymentDate !== "") {
    const parsed = new Date(String(input.paymentDate));
    if (Number.isNaN(parsed.getTime())) {
      throw new PaymentError(400, "Invalid paymentDate");
    }
    paymentDate = parsed;
  }
  if (paymentDate.getTime() > Date.now()) {
    throw new PaymentError(400, "paymentDate cannot be in the future");
  }

  const description =
    input.description === undefined || input.description === null || String(input.description).trim() === ""
      ? null
      : String(input.description).trim().slice(0, 1000);

  const reference =
    input.transactionId === undefined || input.transactionId === null || String(input.transactionId).trim() === ""
      ? generateTransactionId()
      : String(input.transactionId).trim().slice(0, 191);

  return {
    transactionId: reference,
    transactionType: transactionType as TransactionType,
    paymentType,
    type: type as PartyType,
    customerSupplierId: partyId,
    paymentDate,
    paymentAmount: round2(amount),
    description,
  };
}

/**
 * Books a payment and moves the party's dueAmount in the same transaction, so
 * a crash can never leave a Payment row whose balance effect was lost (or the
 * reverse - a balance moved with no ledger row explaining why).
 *
 * Returns the created row plus the party's new due, so the caller can tell the
 * user the settlement actually cleared (or over-cleared) the balance.
 */
export async function createPayment(
  db: PrismaClient,
  session: TenantSession,
  input: CreatePaymentInput
): Promise<{ payment: PaymentRow; dueAmount: number; settled: boolean; bankBalance: number }> {
  const data = validate(input);
  // Resolved outside the transaction so a bad method name is rejected before
  // any locks are taken. See requireActiveBank.
  data.paymentType = await requireActiveBank(db, data.paymentType);

  const result = await db.$transaction(async (tx) => {
    const party = await findParty(tx, data.type, data.customerSupplierId);

    let payment;
    try {
      payment = await tx.payment.create({
        data: {
          transactionId: data.transactionId,
          transactionType: data.transactionType,
          paymentType: data.paymentType,
          type: data.type,
          customerSupplierId: data.customerSupplierId,
          paymentDate: data.paymentDate,
          paymentAmount: data.paymentAmount,
          description: data.description,
        },
      });
    } catch (err) {
      // The UNIQUE transactionId is the double-submit guard, so a collision is
      // an expected outcome of a user mashing the button - report it as a
      // plain 400 rather than letting it surface as a 500.
      if (isUniqueViolation(err)) {
        throw new PaymentError(409, "A payment with this transaction id already exists");
      }
      throw err;
    }

    const delta = DUE_DIRECTION[data.transactionType][data.type] * data.paymentAmount;
    const dueAmount = nextDueAmount(party.dueAmount, delta);

    if (dueAmount !== party.dueAmount) {
      if (data.type === "customer") {
        await tx.customer.update({ where: { id: party.id }, data: { dueAmount } });
      } else {
        await tx.supplier.update({ where: { id: party.id }, data: { dueAmount } });
      }
    }

    // The same movement also has to land on the account it went through. Inside
    // this transaction so a Payment row can never exist with its balance effect
    // missing - and vice versa.
    const bank = await applyBankDelta(
      tx,
      data.paymentType,
      BANK_DIRECTION[data.transactionType] * data.paymentAmount
    );

    await writeAuditLog(tx, session, {
      action: "payment.created",
      entityType: "Payment",
      entityId: payment.id,
      // Money in and money out are not the same fact, so the direction is
      // recorded explicitly alongside the amount and the resulting balance.
      after: {
        transactionId: payment.transactionId,
        transactionType: payment.transactionType,
        paymentType: payment.paymentType,
        type: payment.type,
        customerSupplierId: payment.customerSupplierId,
        paymentAmount: payment.paymentAmount,
        dueBefore: party.dueAmount,
        dueAfter: dueAmount,
        bankBalanceAfter: bank,
      },
    });

    return {
      payment,
      dueAmount,
      dueBefore: party.dueAmount,
      partyName: party.name,
      bankBalance: bank,
    };
  });

  return {
    payment: {
      ...result.payment,
      paymentDate: result.payment.paymentDate.toISOString(),
      createdAt: result.payment.createdAt.toISOString(),
      partyName: result.partyName,
      partyDueAmount: result.dueAmount,
    },
    dueAmount: result.dueAmount,
    // Overpaying (or paying ahead of any due) is allowed; the flag lets the UI
    // say so instead of silently reporting a full settlement.
    settled: result.dueAmount <= 0 && result.dueBefore > 0,
    bankBalance: result.bankBalance,
  };
}

/**
 * Voids a booked payment and puts the balance effect back, so a mistaken entry
 * can be undone without editing history. The row itself is kept (isActive =
 * false) because it is part of the audit trail - and because its reversal is
 * only correct while the row still exists to be explained.
 */
export async function voidPayment(
  db: PrismaClient,
  session: TenantSession,
  id: number
): Promise<{ payment: PaymentRow; dueAmount: number; bankBalance: number }> {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new PaymentError(404, "Payment not found");
    }
    if (!payment.isActive) {
      throw new PaymentError(400, "Payment is already voided");
    }

    const party = await findParty(tx, payment.type, payment.customerSupplierId);

    const updated = await tx.payment.update({
      where: { id },
      data: { isActive: false },
    });

    // Undo exactly what createPayment did: invert the sign, then re-apply the
    // same zero floor.
    const delta = -DUE_DIRECTION[payment.transactionType][payment.type] * payment.paymentAmount;
    const dueAmount = nextDueAmount(party.dueAmount, delta);

    if (payment.type === "customer") {
      await tx.customer.update({ where: { id: party.id }, data: { dueAmount } });
    } else {
      await tx.supplier.update({ where: { id: party.id }, data: { dueAmount } });
    }

    // ...and invert the account movement too, or the balance would keep the
    // money that just stopped having moved.
    const bankBalance = await applyBankDelta(
      tx,
      payment.paymentType,
      -BANK_DIRECTION[payment.transactionType] * payment.paymentAmount
    );

    await writeAuditLog(tx, session, {
      action: "payment.voided",
      entityType: "Payment",
      entityId: payment.id,
      before: {
        transactionId: payment.transactionId,
        paymentAmount: payment.paymentAmount,
        dueBefore: party.dueAmount,
      },
      after: {
        transactionId: payment.transactionId,
        isActive: false,
        dueAfter: dueAmount,
        bankBalanceAfter: bankBalance,
      },
    });

    return {
      payment: {
        ...updated,
        paymentDate: updated.paymentDate.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        partyName: party.name,
        partyDueAmount: dueAmount,
      },
      dueAmount,
      bankBalance,
    };
  });
}

/**
 * Edits a booked payment in place. Voiding and re-recording would produce the
 * same ledger but leaves two rows, so a correction is a real update - with the
 * balance moved to match.
 *
 * The balance is fixed up in two steps rather than with one combined delta:
 * invert exactly what `createPayment` did (which can only ever push the balance
 * up, so the zero floor never bites), then apply exactly what the corrected
 * payment does (which can only push it down, so the floor applies). That makes
 * an edit indistinguishable from void-then-record, including when the operator
 * moved the money to a different party entirely - the old party gets its old
 * delta back and the new one is applied fresh.
 *
 * The account's balance gets the same two-step treatment, with one addition:
 * when the correction names a *different* account, the old account is only
 * debited back - never checked for being active. An account deactivated since
 * the payment was booked still holds that posting, and this row is the only
 * thing that can undo it.
 */
export async function updatePayment(
  db: PrismaClient,
  session: TenantSession,
  id: number,
  input: UpdatePaymentInput
): Promise<{ payment: PaymentRow; dueAmount: number; bankBalance: number }> {
  return db.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { id } });
    if (!existing) {
      throw new PaymentError(404, "Payment not found");
    }
    // A voided row is frozen history: its reversal is already in the balances,
    // so editing it would double-count. Re-record a new payment instead.
    if (!existing.isActive) {
      throw new PaymentError(400, "A voided payment cannot be edited");
    }

    const data = validate({
      ...input,
      // Unlike a create there is nothing to mint when the reference is blank -
      // keep whatever the row already carries so the UNIQUE guard stays honest.
      transactionId:
        input.transactionId === undefined ||
        input.transactionId === null ||
        String(input.transactionId).trim() === ""
          ? existing.transactionId
          : input.transactionId,
    });
    // Only the corrected method has to be selectable; the old one just has to
    // still exist so it can be credited back below. Read through the
    // transaction rather than a second connection, so this cannot block on a
    // lock the same transaction is about to take.
    data.paymentType = await requireActiveBank(tx, data.paymentType);

    const sameParty =
      existing.type === data.type && existing.customerSupplierId === data.customerSupplierId;

    const oldParty = await findParty(tx, existing.type, existing.customerSupplierId);
    // On a new party, that party's balance is read fresh - it is untouched by
    // the reversal happening on the old one.
    const newParty = sameParty ? null : await findParty(tx, data.type, data.customerSupplierId);

    // Step 1 - undo the movement as booked.
    const revertDelta = -DUE_DIRECTION[existing.transactionType][existing.type] * existing.paymentAmount;
    const revertedDue = nextDueAmount(oldParty.dueAmount, revertDelta);

    // Step 2 - apply the movement as corrected, starting from whichever party
    // now owns it.
    const delta = DUE_DIRECTION[data.transactionType][data.type] * data.paymentAmount;
    const dueAmount = nextDueAmount(sameParty ? revertedDue : newParty!.dueAmount, delta);

    let updated;
    try {
      updated = await tx.payment.update({
        where: { id },
        data: {
          transactionId: data.transactionId,
          transactionType: data.transactionType,
          paymentType: data.paymentType,
          type: data.type,
          customerSupplierId: data.customerSupplierId,
          paymentDate: data.paymentDate,
          paymentAmount: data.paymentAmount,
          description: data.description,
        },
      });
    } catch (err) {
      // Swapping in a reference another row already holds is the same
      // double-booking guard a create hits, so it gets the same 409.
      if (isUniqueViolation(err)) {
        throw new PaymentError(409, "A payment with this transaction id already exists");
      }
      throw err;
    }

    // Exactly one write per party that was touched. When the party is
    // unchanged both steps landed on the same row, so only the FINAL balance
    // is written - writing `revertedDue` here instead would persist the
    // intermediate step and silently drop the corrected amount.
    if (sameParty) {
      await applyDueAmount(tx, data.type, data.customerSupplierId, dueAmount);
    } else {
      await applyDueAmount(tx, existing.type, existing.customerSupplierId, revertedDue);
      await applyDueAmount(tx, data.type, data.customerSupplierId, dueAmount);
    }

    // The account balance follows the same undo-then-apply order as the party's
    // due. Correcting a payment that named the wrong account therefore moves
    // the money from where it was actually booked to where it should have been.
    await applyBankDelta(
      tx,
      existing.paymentType,
      -BANK_DIRECTION[existing.transactionType] * existing.paymentAmount
    );
    const bankBalance = await applyBankDelta(
      tx,
      data.paymentType,
      BANK_DIRECTION[data.transactionType] * data.paymentAmount
    );

    await writeAuditLog(tx, session, {
      action: "payment.updated",
      entityType: "Payment",
      entityId: id,
      // Both the row and the balances it touched, so an auditor can see the
      // correction rather than infer it from the current state.
      before: {
        transactionId: existing.transactionId,
        transactionType: existing.transactionType,
        paymentType: existing.paymentType,
        type: existing.type,
        customerSupplierId: existing.customerSupplierId,
        paymentAmount: existing.paymentAmount,
        dueAmount: oldParty.dueAmount,
      },
      after: {
        transactionId: updated.transactionId,
        transactionType: updated.transactionType,
        paymentType: updated.paymentType,
        type: updated.type,
        customerSupplierId: updated.customerSupplierId,
        paymentAmount: updated.paymentAmount,
        dueAmount,
        bankBalanceAfter: bankBalance,
      },
    });

    return {
      payment: {
        ...updated,
        paymentDate: updated.paymentDate.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        partyName: (sameParty ? oldParty : newParty!).name,
        partyDueAmount: dueAmount,
      },
      dueAmount,
      bankBalance,
    };
  });
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

export type ListPaymentsFilters = {
  type?: string | null;
  transactionType?: string | null;
  search?: string | null;
  includeVoided?: boolean;
  limit?: number;
};

const MAX_SCAN = 500;

/**
 * Lists payments newest-first with the party's name and current balance
 * resolved in. `customerSupplierId` is a bare int, so the two sides are looked
 * up separately and stitched together here rather than by a JOIN.
 *
 * `search` spans the reference, the description and the party name, which
 * can't be pushed into the WHERE clause without the name lookup first, so it
 * is applied after resolution over a bounded recent window.
 */
export async function listPayments(db: PrismaClient, filters: ListPaymentsFilters): Promise<PaymentRow[]> {
  const where: Prisma.PaymentWhereInput = {};
  if (filters.type && PARTY_TYPES.has(filters.type)) {
    where.type = filters.type as PartyType;
  }
  if (filters.transactionType && TRANSACTION_TYPES.has(filters.transactionType)) {
    where.transactionType = filters.transactionType as TransactionType;
  }
  if (!filters.includeVoided) {
    where.isActive = true;
  }

  const rows = await db.payment.findMany({
    where,
    orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
    take: MAX_SCAN,
  });

  const customerIds = [...new Set(rows.filter((r) => r.type === "customer").map((r) => r.customerSupplierId))];
  const supplierIds = [...new Set(rows.filter((r) => r.type === "supplier").map((r) => r.customerSupplierId))];

  const [customers, suppliers] = await Promise.all([
    customerIds.length
      ? db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, dueAmount: true } })
      : [],
    supplierIds.length
      ? db.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, dueAmount: true } })
      : [],
  ]);

  const byKey = new Map<string, PartyRow>();
  for (const c of customers) byKey.set(`customer:${c.id}`, c);
  for (const s of suppliers) byKey.set(`supplier:${s.id}`, s);

  const query = filters.search?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), MAX_SCAN);

  return rows
    .map((row) => {
      const party = byKey.get(`${row.type}:${row.customerSupplierId}`);
      return {
        id: row.id,
        transactionId: row.transactionId,
        transactionType: row.transactionType,
        paymentType: row.paymentType,
        type: row.type,
        customerSupplierId: row.customerSupplierId,
        paymentDate: row.paymentDate.toISOString(),
        paymentAmount: row.paymentAmount,
        description: row.description,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        partyName: party?.name ?? "#" + row.customerSupplierId,
        partyDueAmount: party?.dueAmount ?? 0,
      } satisfies PaymentRow;
    })
    .filter((row) => {
      if (!query) return true;
      return (
        row.transactionId.toLowerCase().includes(query) ||
        (row.description ?? "").toLowerCase().includes(query) ||
        row.partyName.toLowerCase().includes(query)
      );
    })
    .slice(0, limit);
}

/**
 * The party options for the form: every customer and supplier with the balance
 * currently outstanding, so the operator can see what they are settling before
 * typing an amount. Suppliers/customer with a due are listed first - they are
 * the reason you open this screen.
 */
export async function listPaymentParties(
  db: PrismaClient
): Promise<{ customers: PaymentParty[]; suppliers: PaymentParty[] }> {
  const [customers, suppliers] = await Promise.all([
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, dueAmount: true } }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, dueAmount: true } }),
  ]);
  return { customers, suppliers };
}

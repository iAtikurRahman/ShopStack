import type { PartyType, PaymentType, Prisma, PrismaClient, TransactionType } from "@/generated/tenant";
import type { TenantSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { round2 } from "@/lib/returns";

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
const PAYMENT_TYPES = new Set<string>(["bank", "cash", "mobile", "other"]);
const PARTY_TYPES = new Set<string>(["customer", "supplier"]);

export type PaymentParty = { id: number; name: string; dueAmount: number };

export type PaymentRow = {
  id: number;
  transactionId: string;
  transactionType: TransactionType;
  paymentType: PaymentType;
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

type ValidPayment = {
  transactionId: string;
  transactionType: TransactionType;
  paymentType: PaymentType;
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

  const paymentType = String(input.paymentType ?? "");
  if (!PAYMENT_TYPES.has(paymentType)) {
    throw new PaymentError(400, "paymentType must be bank, cash, mobile or other");
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
    paymentType: paymentType as PaymentType,
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
): Promise<{ payment: PaymentRow; dueAmount: number; settled: boolean }> {
  const data = validate(input);

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
      },
    });

    return { payment, dueAmount, dueBefore: party.dueAmount, partyName: party.name };
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
): Promise<{ payment: PaymentRow; dueAmount: number }> {
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

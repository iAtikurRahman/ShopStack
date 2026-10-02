import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { BankTransferError, deleteBankTransfer, updateBankTransfer } from "@/lib/bank-transfers";

// Editing a transfer moves two account balances, so it takes the same
// permission as recording a payment.
export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ message: "Invalid transfer id" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await updateBankTransfer(db, session, id, body ?? {}));
  } catch (err) {
    if (err instanceof BankTransferError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

// The "delete" action is a void, not a row removal: the amount already moved
// between the two accounts, so it goes back where it came from and comes out of
// where it went. The transfer stays visible as voided.
export const DELETE = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ message: "Invalid transfer id" }, { status: 400 });
  }
  try {
    return NextResponse.json(await deleteBankTransfer(db, session, id));
  } catch (err) {
    if (err instanceof BankTransferError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

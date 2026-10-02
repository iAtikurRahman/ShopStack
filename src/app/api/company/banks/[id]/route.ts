import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { BankError, deleteBank, updateBank } from "@/lib/banks";

// Editing balances is a bookkeeping act, so it takes the same permission as
// recording a payment. The name is not editable here - see updateBank.
export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ message: "Invalid bank id" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json({ bank: await updateBank(db, session, id, body ?? {}) });
  } catch (err) {
    if (err instanceof BankError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

// For accounts that were never used - a typo, or a second bKash added by
// mistake. Anything a sale or payment already names is deleted only after
// deleteBank confirms nothing points at it; deactivate covers the rest, and
// either way the account leaves every payment-method dropdown.
export const DELETE = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ message: "Invalid bank id" }, { status: 400 });
  }
  try {
    return NextResponse.json(await deleteBank(db, session, id));
  } catch (err) {
    if (err instanceof BankError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

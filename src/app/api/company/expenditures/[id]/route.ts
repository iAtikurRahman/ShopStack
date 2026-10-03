import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { BankError } from "@/lib/banks";
import { ExpenditureError, updateExpenditure, voidExpenditure } from "@/lib/expenditures";

function badId() {
  return NextResponse.json({ message: "Invalid expenditure id" }, { status: 400 });
}

export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return badId();
  const body = (await request.json().catch(() => null)) ?? {};
  try {
    return NextResponse.json(await updateExpenditure(db, session, id, body as Record<string, unknown>));
  } catch (err) {
    if (err instanceof ExpenditureError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    if (err instanceof BankError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

// "Delete" on this screen means void: the voucher is kept and marked inactive,
// and every peso goes back onto the account it left. See voidExpenditure - there
// is no hard delete on purpose.
export const DELETE = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return badId();
  try {
    return NextResponse.json(await voidExpenditure(db, session, id));
  } catch (err) {
    if (err instanceof ExpenditureError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    // Putting the money back still touches bank_info, so a missing account
    // refuses here the same way it does on create and edit.
    if (err instanceof BankError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { WithdrawalError, updateWithdrawal, voidWithdrawal } from "@/lib/withdrawals";

function badId() {
  return NextResponse.json({ message: "Invalid withdrawal id" }, { status: 400 });
}

export const PATCH = withAuth<{ id: string }>(async (request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return badId();
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await updateWithdrawal(db, session, id, body ?? {}));
  } catch (err) {
    if (err instanceof WithdrawalError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

// "Delete" on this screen means void: the slip is kept and marked inactive, and
// the amount goes back onto the account it was taken from. See voidWithdrawal -
// there is no hard delete on purpose.
export const DELETE = withAuth<{ id: string }>(async (_request, { session, db, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return badId();
  try {
    return NextResponse.json(await voidWithdrawal(db, session, id));
  } catch (err) {
    if (err instanceof WithdrawalError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

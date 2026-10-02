import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { WithdrawalError, createWithdrawal, listWithdrawals } from "@/lib/withdrawals";

// Company-wide, because the thing a withdrawal names - an account in bank_info -
// is company-wide too: the owner takes cash out of the till, not out of one
// store's slice of it. Reading is open to every store role so a manager can see
// what has been handed over; writing takes the same permission as managing an
// account's balance, since it moves that balance.
export const GET = withAuth(async (_request, { db }) => {
  return NextResponse.json({ withdrawals: await listWithdrawals(db) });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  try {
    const result = await createWithdrawal(db, session, body ?? {});
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof WithdrawalError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

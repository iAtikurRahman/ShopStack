import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { BankError } from "@/lib/banks";
import {
  ExpenditureError,
  createExpenditure,
  listActiveExpenditureHeads,
  listExpenditures,
} from "@/lib/expenditures";

// Company-wide, for the same reason Withdrawal is: the thing an expenditure
// moves money through - an account in bank_info - is company-wide too. Reading is
// open to every store role so a manager can see what the business spends on;
// writing takes the same permission as managing an account's balance, because it
// is exactly that.
//
// The head list rides along with the vouchers rather than being a second request:
// the line dropdown needs it the moment the form renders, and it is a handful of
// rows. Only the active heads come back - a retired head has to stay out of a new
// voucher while remaining readable on the vouchers that already used it.
export const GET = withAuth(async (_request, { db }) => {
  const [expenditures, heads] = await Promise.all([
    listExpenditures(db),
    listActiveExpenditureHeads(db),
  ]);
  return NextResponse.json({ expenditures, heads });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = (await request.json().catch(() => null)) ?? {};
  try {
    const result = await createExpenditure(db, session, body as Record<string, unknown>);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ExpenditureError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    // A voucher can name an account that does not exist, and that refusal comes
    // from the bank helpers rather than the expenditure ones.
    if (err instanceof BankError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });
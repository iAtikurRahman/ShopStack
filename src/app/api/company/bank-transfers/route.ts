import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { BankTransferError, createBankTransfer, listBankTransfers } from "@/lib/bank-transfers";

// Company-wide, for the same reason withdrawals are: both accounts a transfer
// names live in bank_info, which is company-wide, so the money is not tied to
// one store's slice of it. Reading is open to every store role so a manager can
// see what has been moved; writing takes the same permission as managing an
// account's balance, since it moves two of them.
export const GET = withAuth(async (_request, { db }) => {
  return NextResponse.json({ transfers: await listBankTransfers(db) });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  try {
    const result = await createBankTransfer(db, session, body ?? {});
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof BankTransferError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { BankError, createBank, listBanks } from "@/lib/banks";

// Accounts are company-wide, exactly like Payment / Customer / Supplier - a
// till at one store settles into the same drawer as the next one, so there is
// nothing store-scoped to slice. Reads and writes differ only in who may do
// them: every role can see the list (the POS needs it), only a manager can
// change it.
export const GET = withAuth(async (_request, { db }) => {
  const banks = await listBanks(db);
  return NextResponse.json({ banks });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = await request.json().catch(() => null);
  try {
    const bank = await createBank(db, session, body ?? {});
    return NextResponse.json({ bank }, { status: 201 });
  } catch (err) {
    if (err instanceof BankError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_manage_payments" });

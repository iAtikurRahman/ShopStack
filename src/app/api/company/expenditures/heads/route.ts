import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { ExpenditureError, createExpenditureHead, listExpenditureHeads } from "@/lib/expenditures";

// The management list, which includes deactivated heads so the owner can see and
// reactivate one that old vouchers point at. The dropdown on the expenditure form
// is built from the GET on /api/company/expenditures instead, which returns only
// the active ones - see the comment there.
//
// Separate from the vouchers on purpose: adding a head is naming a category, not
// moving money, so it is allowed to every store role that can see the screen.
// Nothing here touches a balance.
export const GET = withAuth(async (_request, { db }) => {
  return NextResponse.json({ heads: await listExpenditureHeads(db) });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

export const POST = withAuth(async (request, { session, db }) => {
  const body = (await request.json().catch(() => null)) ?? {};
  try {
    const head = await createExpenditureHead(db, session, body);
    return NextResponse.json({ head }, { status: 201 });
  } catch (err) {
    if (err instanceof ExpenditureError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    throw err;
  }
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });
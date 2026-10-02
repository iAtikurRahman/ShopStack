import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { listActiveBanks } from "@/lib/banks";

// Read-only and open to every store role, because the POS tender, the purchase
// form and the payments ledger all build their payment-method dropdown from
// this - a store_user has to be able to ring up a sale without being able to
// edit an account's balances. Editing lives on /api/company/banks.
export const GET = withAuth(async (_request, { db }) => {
  const banks = await listActiveBanks(db);
  return NextResponse.json({ banks });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { getStoreReport } from "@/lib/reports";

// A thin wrapper: the query itself lives in lib/reports so the dashboard can
// render the same numbers server-side without going through HTTP.
export const GET = withAuth(async (_request, { session, db }) => {
  return NextResponse.json(await getStoreReport(db, session));
}, { scope: "tenant", roles: ["company_admin", "store_manager"], permission: "can_view_reports" });